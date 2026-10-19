import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

const userRoom = (userId: string) => `user:${userId}`;

/**
 * The bell, live (§287). Each signed-in app keeps one socket here, in a room
 * of its own person; a new notification is announced on it the moment it is
 * made, and the app fetches its list again. The list itself stays REST — this
 * only says "something new", the same narrow job the chat socket does (§22).
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server?: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** As strict as the REST guard: no valid token, no socket. */
  async handleConnection(client: Socket) {
    const header = client.handshake.headers?.authorization;
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      await client.join(userRoom(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  /** Tells this person's open apps that something new arrived. Never throws. */
  announce(userId: string, payload: { id: string; type: string; subject: string }) {
    try {
      this.server?.to(userRoom(userId)).emit('notification:new', payload);
    } catch (error) {
      this.logger.warn(`Could not announce a notification: ${error instanceof Error ? error.message : error}`);
    }
  }
}
