import { Inject, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ChatService } from './chat.service';

/** socket.io room name for a thread. One room per conversation. */
const threadRoom = (threadId: string) => `thread:${threadId}`;

interface SocketUser {
  userId: string;
  email: string;
  role: string;
}

/**
 * Realtime delivery for chat.
 *
 * Push-only, and deliberately narrow. The socket does exactly one thing the
 * REST API cannot: tell a client a message arrived without being asked.
 * Everything else — creating messages, listing history, uploading photos —
 * stays on the REST endpoints from §21, which remain the single source of
 * truth. See DECISIONS.md §22 for why.
 *
 * There is no `message:send` event, on purpose. Message creation carries
 * validation, the empty-message rule, photo upload through StorageService and
 * the notification debounce; duplicating that over a second transport would
 * mean two paths that must be kept in agreement forever. Sending is REST,
 * receiving is socket.
 *
 * Reconnection is not handled here either. A client that reconnects calls
 * `GET /threads/:id/messages` to catch up, then relies on the socket for what
 * arrives after that. Replay-on-reconnect inside the gateway would duplicate
 * the pagination and ordering the REST endpoint already gets right.
 */
@WebSocketGateway({
  namespace: '/chat',
  // Matches the REST app's permissive CORS. Tighten both together before
  // production — see main.ts.
  cors: { origin: '*' },
})
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    // ChatService emits through this gateway, and this gateway calls back into
    // ChatService for participation checks — a genuine cycle that forwardRef
    // is the standard resolution for.
    @Inject(forwardRef(() => ChatService))
    private readonly chat: ChatService,
  ) {}

  /**
   * Authenticates the connection, or drops it.
   *
   * The token comes from the socket.io `auth` handshake payload rather than a
   * query string: query strings end up in access logs, proxy logs and browser
   * history, and an access token in any of those is a credential leak. The
   * handshake payload is sent in the connection body instead.
   *
   * As strict as JwtAuthGuard on the REST side — a missing, malformed or
   * expired token disconnects rather than degrading to an anonymous socket.
   * There is nothing useful an unauthenticated socket could subscribe to here.
   */
  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      // Also accepted, because some clients cannot set handshake auth. Still
      // a header, never a query parameter.
      this.bearerFromHeader(client.handshake.headers?.authorization);

    if (!token) {
      this.reject(client, 'Authentication required. Connect with { auth: { token } }.');
      return;
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });

      const user: SocketUser = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };
      client.data.user = user;

      this.logger.log(`Socket ${client.id} connected as ${user.email} (${user.role}).`);
      client.emit('connected', { userId: user.userId, role: user.role });
    } catch {
      // Deliberately not distinguishing expired from malformed from
      // wrong-signature: all three mean "not authenticated", and the
      // difference is only useful to someone probing.
      this.reject(client, 'Invalid or expired token.');
    }
  }

  /**
   * Subscribes the socket to a thread's room, if the user really is a
   * participant.
   *
   * The check is ChatService's own — the same one the REST endpoints use — so
   * there is exactly one definition of who may see a thread. A non-participant
   * gets an explicit error event and is NOT joined; failing silently would
   * leave a client believing it is subscribed and quietly missing every
   * message.
   */
  @SubscribeMessage('thread:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { threadId?: string },
  ) {
    const user = client.data.user as SocketUser | undefined;
    if (!user) return this.errorAck(client, 'thread:join', 'Not authenticated.');

    const threadId = payload?.threadId;
    if (!threadId) {
      return this.errorAck(client, 'thread:join', 'threadId is required.');
    }

    try {
      await this.chat.assertParticipant(user.userId, threadId, user.role);
    } catch {
      // Same wording as the REST 404. Confirming a thread exists but belongs
      // to someone else is the leak §21.8 avoids, and it should not become
      // observable just because the transport changed.
      return this.errorAck(client, 'thread:join', 'Thread not found.');
    }

    await client.join(threadRoom(threadId));
    this.logger.log(`Socket ${client.id} (${user.email}) joined thread ${threadId}.`);
    client.emit('thread:joined', { threadId });
    return { ok: true, threadId };
  }

  @SubscribeMessage('thread:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { threadId?: string },
  ) {
    if (!payload?.threadId) {
      return this.errorAck(client, 'thread:leave', 'threadId is required.');
    }
    await client.leave(threadRoom(payload.threadId));
    client.emit('thread:left', { threadId: payload.threadId });
    return { ok: true };
  }

  /**
   * Marks a thread read over the socket.
   *
   * Calls the same ChatService.markRead as `POST /threads/:id/read`, so read
   * state cannot diverge between transports. Offered because marking read is
   * the one write that naturally happens while a socket is already open — the
   * user is looking at the conversation.
   */
  @SubscribeMessage('thread:read')
  async handleRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { threadId?: string },
  ) {
    const user = client.data.user as SocketUser | undefined;
    if (!user) return this.errorAck(client, 'thread:read', 'Not authenticated.');
    if (!payload?.threadId) {
      return this.errorAck(client, 'thread:read', 'threadId is required.');
    }

    try {
      const result = await this.chat.markRead(user.userId, payload.threadId, user.role);
      client.emit('thread:read:ok', { threadId: payload.threadId, ...result });
      return { ok: true, ...result };
    } catch {
      return this.errorAck(client, 'thread:read', 'Thread not found.');
    }
  }

  /**
   * Pushes a newly created message to everyone in the thread's room.
   *
   * Called by ChatService immediately after a message is persisted, next to
   * the existing notification call — so the socket and the email are triggered
   * by the same event, and neither can fire for a message that was not saved.
   *
   * Never throws: realtime delivery is a convenience on top of a message that
   * already exists, and a socket problem must not fail the REST request that
   * created it. Same rule notifications follow (§20.3).
   */
  emitNewMessage(threadId: string, message: unknown): void {
    try {
      // The server is undefined if the websocket adapter never initialised —
      // for example in a test harness that boots an application context
      // without a listening server.
      if (!this.server) {
        this.logger.warn(`No socket server; cannot push to thread ${threadId}.`);
        return;
      }
      const room = threadRoom(threadId);
      // Room membership is useful in logs when debugging "why did nobody get
      // it?". socket.io's Namespace exposes an adapter with a rooms map; the
      // published typings model `adapter` as the Server-level overload, hence
      // the narrow cast rather than a broad `any` on the emit itself.
      const rooms = (this.server.adapter as unknown as { rooms?: Map<string, Set<string>> })
        ?.rooms;
      this.logger.log(
        `Pushing message:new to ${room} (${rooms?.get(room)?.size ?? 0} socket(s) in room).`,
      );
      this.server.to(room).emit('message:new', message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not push message to thread ${threadId}: ${detail}`);
    }
  }

  // ---------- helpers ----------

  private bearerFromHeader(header?: string): string | undefined {
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.slice('Bearer '.length).trim() || undefined;
  }

  private reject(client: Socket, reason: string) {
    this.logger.warn(`Rejecting socket ${client.id}: ${reason}`);
    client.emit('error', { event: 'connection', message: reason });
    client.disconnect(true);
  }

  /** Emits an error event AND returns it, so callbacks and listeners both see it. */
  private errorAck(client: Socket, event: string, message: string) {
    client.emit('error', { event, message });
    return { ok: false, error: message };
  }
}
