import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessMemberStatus,
  BusinessStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MESSAGE_SELECT,
  ThreadDto,
  ThreadPageDto,
  ThreadReadDto,
} from './dto/chat-response.dto';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatRealtimePublisher, NOOP_CHAT_REALTIME } from './chat-realtime.interface';

/** New inquiry threads one customer may open in a rolling 24 hours. */
export const MAX_INQUIRY_THREADS_PER_DAY = 10;

/** At most one "new message" email per thread, per recipient, per this window. */
export const MESSAGE_NOTIFICATION_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * What a message's sender looks like to the person reading it (§112.1).
 *
 * A customer never gets an email. The sender rows carry one — the login address
 * of whoever at the shop typed the reply — and returning it told every customer
 * who messaged a business the personal email of its staff. §92.2 settled this
 * for reviews ("the byline is the display name and nothing else — never an id
 * or an email") and chat simply did not follow.
 *
 * A customer needs to know whether a message is theirs, which `id` and `role`
 * answer, and which shop it came from, which is on the thread. Nothing about
 * WHICH member of staff is the customer's business.
 *
 * A business keeps it: they are entitled to the customer's address (§28.6), and
 * on their own side it is how several members of staff (§14) tell each other
 * apart in a thread.
 */
type SenderRow = { id: string; email: string; role: UserRole };

function visibleSender(sender: SenderRow, viewerRole: UserRole) {
  if (viewerRole === UserRole.CUSTOMER) {
    const { email: _hidden, ...rest } = sender;
    return rest;
  }
  return sender;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Where realtime pushes go. Defaults to a no-op so this service never has to
   * null-check, and so it works unchanged in tests and in any context with no
   * websocket transport.
   *
   * REGISTERED BY THE GATEWAY, not injected. ChatGateway needs ChatService for
   * its participation checks, so injecting the gateway back into this service —
   * by class, by token, or via `useExisting` — is a dependency cycle that hangs
   * Nest's injector at boot with no error. Letting the gateway hand itself over
   * on init keeps the dependency strictly one-directional.
   */
  private realtime: ChatRealtimePublisher = NOOP_CHAT_REALTIME;

  registerRealtimePublisher(publisher: ChatRealtimePublisher): void {
    this.realtime = publisher;
  }

  // ---------- Threads ----------

  /**
   * Opens a pre-booking inquiry thread, or returns the existing one.
   *
   * Idempotent by design: one inquiry thread per customer-business pair, reused
   * for every future question. A customer asking a second question weeks later
   * should land in the same conversation, not start a parallel one the business
   * has to notice separately.
   */
  async createInquiryThread(customerId: string, businessProfileId: string) {
    const business = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: { id: true, status: true },
    });

    // 404 rather than 403 for a non-approved business, matching the
    // availability rule (§13.2): the public should not be able to tell an
    // unapproved business apart from one that does not exist.
    if (!business || business.status !== BusinessStatus.APPROVED) {
      throw new NotFoundException('Business not found.');
    }

    const existing = await this.prisma.thread.findFirst({
      where: { customerId, businessProfileId, appointmentId: null },
      select: { id: true },
    });
    if (existing) {
      // Reuse never counts against the rate limit — the limit exists to stop a
      // customer spraying NEW conversations across many businesses, not to
      // ration questions within a relationship that already exists.
      return this.loadThread(existing.id, customerId);
    }

    await this.assertInquiryRateLimit(customerId);

    try {
      const thread = await this.prisma.thread.create({
        data: { customerId, businessProfileId },
        select: { id: true },
      });
      return this.loadThread(thread.id, customerId);
    } catch (error) {
      // The partial unique index is the real guard: two simultaneous requests
      // both pass the existence check above, and one of them loses here. That
      // is not an error worth surfacing — the caller wanted a thread, and one
      // now exists.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.thread.findFirst({
          where: { customerId, businessProfileId, appointmentId: null },
          select: { id: true },
        });
        if (raced) return this.loadThread(raced.id, customerId);
      }
      throw error;
    }
  }

  private async assertInquiryRateLimit(customerId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.thread.count({
      where: { customerId, appointmentId: null, createdAt: { gte: since } },
    });

    if (recent >= MAX_INQUIRY_THREADS_PER_DAY) {
      throw new BadRequestException(
        `You can start at most ${MAX_INQUIRY_THREADS_PER_DAY} new conversations per day. ` +
          'You can still reply in conversations you already have.',
      );
    }
  }

  /**
   * Creates the thread that belongs to a booking.
   *
   * Called from the appointment creation flow rather than exposed as an
   * endpoint: a booking always has somewhere to talk, without the customer
   * having to do anything to make it so.
   *
   * Never throws — a chat thread failing to materialise must not roll back a
   * paid-for booking, the same rule notifications follow (§20.3).
   */
  async createAppointmentThread(params: {
    appointmentId: string;
    customerId: string;
    businessProfileId: string;
  }): Promise<void> {
    try {
      await this.prisma.thread.create({
        data: {
          appointmentId: params.appointmentId,
          customerId: params.customerId,
          businessProfileId: params.businessProfileId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Could not create thread for appointment ${params.appointmentId}: ${message}`,
      );
    }
  }

  /**
   * Threads the caller can see: a customer's own, or every thread belonging to
   * the business they are an active member of.
   */
  async listThreads(
    userId: string,
    role: UserRole,
    limit: number,
    offset: number,
    appointmentId?: string,
  ): Promise<ThreadPageDto> {
    const scope = await this.participantScope(userId, role);
    // Narrowed INSIDE the caller's scope, never instead of it: an appointment
    // id belonging to someone else matches nothing rather than reaching their
    // conversation.
    const where = appointmentId ? { ...scope, appointmentId } : scope;

    const [total, threads] = await Promise.all([
      this.prisma.thread.count({ where }),
      this.prisma.thread.findMany({
        where,
        // Most recent conversation first. Threads with no messages yet sort
        // last, which is right — an empty thread has nothing to catch up on.
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        select: THREAD_SELECT,
      }),
    ]);

    const decorated = await Promise.all(
      threads.map((thread) => this.decorate(thread, userId)),
    );

    return { total, limit, offset, threads: decorated };
  }

  async getThread(
    userId: string,
    threadId: string,
    role: UserRole,
  ): Promise<ThreadDto> {
    await this.requireParticipant(userId, threadId, role);
    return this.loadThread(threadId, userId);
  }

  // ---------- Messages ----------

  async listMessages(
    userId: string,
    threadId: string,
    role: UserRole,
    limit: number,
    offset: number,
  ) {
    await this.requireParticipant(userId, threadId, role);

    const [total, messages] = await Promise.all([
      this.prisma.message.count({ where: { threadId } }),
      this.prisma.message.findMany({
        where: { threadId },
        // Chronological: a conversation reads forwards.
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
        select: MESSAGE_SELECT,
      }),
    ]);

    return {
      total,
      limit,
      offset,
      messages: messages.map((m) => ({ ...m, sender: visibleSender(m.sender, role) })),
    };
  }

  async sendMessage(params: {
    userId: string;
    role: UserRole;
    threadId: string;
    body?: string;
    file?: Express.Multer.File;
  }) {
    const thread = await this.requireParticipant(
      params.userId,
      params.threadId,
      params.role,
    );

    const body = params.body?.trim() ? params.body.trim() : null;

    // A message has to say something. Checked here for a clear error, and
    // again by the messages_content_not_empty CHECK so the rule holds however
    // a row is inserted.
    if (!body && !params.file) {
      throw new BadRequestException(
        'A message needs text, a photo, or both. Send "body" as a text field, a "photo" file, or both.',
      );
    }

    // Reuses StorageService exactly as the gallery does (§10.6): R2 when
    // configured, the dev-only local fallback otherwise.
    const photoUrl = params.file
      ? await this.storage.upload(
          params.file.buffer,
          params.file.mimetype,
          `chat/${params.threadId}`,
        )
      : null;

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { threadId: params.threadId, senderId: params.userId, body, photoUrl },
        select: MESSAGE_SELECT,
      });

      // Denormalised ordering key, updated in the same transaction so the
      // thread list can never show a thread as older than its newest message.
      await tx.thread.update({
        where: { id: params.threadId },
        data: { lastMessageAt: created.createdAt },
      });

      return created;
    });

    // Realtime push and the debounced email are triggered by the same event,
    // right after the message is persisted — so neither can fire for a message
    // that was not saved, and the socket cannot disagree with what REST stored.
    // The room holds both sides, so one payload cannot be tailored per viewer —
    // it carries the narrower shape, and a business that wants the address has
    // it on the thread already (§112.1).
    this.realtime.emitNewMessage(params.threadId, {
      ...message,
      sender: visibleSender(message.sender, UserRole.CUSTOMER),
    });

    await this.notifyOtherParty(thread, params.userId, body, Boolean(photoUrl));

    return { ...message, sender: visibleSender(message.sender, params.role) };
  }

  /**
   * Tells the other side, at most once per thread per recipient per 5 minutes.
   *
   * A back-and-forth conversation would otherwise produce an email per line.
   * The debounce marker is `lastNotifiedAt` on ThreadReadState, claimed the
   * same way appointment reminders claim `reminderSentAt` (§20.5) — the window
   * is checked and the timestamp written before the notification is raised, so
   * two rapid messages cannot both slip through.
   *
   * Only the OTHER party is notified; nobody needs an email about their own
   * message.
   */
  private async notifyOtherParty(
    thread: ThreadRecord,
    senderId: string,
    body: string | null,
    hasPhoto: boolean,
  ) {
    const recipients: string[] = [];

    if (thread.customerId === senderId) {
      // Customer wrote: tell every active member of the business, for the same
      // reason bookings go to all of them (§20.4) — whoever is on the floor
      // should see it.
      const members = await this.prisma.businessMembership.findMany({
        where: {
          businessProfileId: thread.businessProfileId,
          status: BusinessMemberStatus.ACTIVE,
        },
        select: { userId: true },
      });
      recipients.push(...members.map((m) => m.userId));
    } else {
      recipients.push(thread.customerId);
    }

    const cutoff = new Date(Date.now() - MESSAGE_NOTIFICATION_DEBOUNCE_MS);
    const preview = body
      ? body.slice(0, 140)
      : hasPhoto
        ? 'Sent a photo.'
        : '';

    for (const recipientId of recipients) {
      if (recipientId === senderId) continue;

      // Claim the window first. updateMany with the cutoff in the WHERE clause
      // makes this atomic: a second concurrent message matches no row.
      const { count } = await this.prisma.threadReadState.updateMany({
        where: {
          threadId: thread.id,
          userId: recipientId,
          OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: cutoff } }],
        },
        data: { lastNotifiedAt: new Date() },
      });

      let mayNotify = count > 0;

      if (count === 0) {
        // No row yet — this person has never read or been notified about this
        // thread. Create one, and treat a successful create as claiming the
        // window.
        const existing = await this.prisma.threadReadState.count({
          where: { threadId: thread.id, userId: recipientId },
        });
        if (existing === 0) {
          await this.prisma.threadReadState.create({
            data: {
              threadId: thread.id,
              userId: recipientId,
              // Epoch: they have read nothing in this thread yet.
              lastReadAt: new Date(0),
              lastNotifiedAt: new Date(),
            },
          });
          mayNotify = true;
        }
      }

      if (!mayNotify) continue;

      await this.notifications.notify({
        recipientId,
        type: NotificationType.NEW_MESSAGE,
        context: {
          serviceName: '',
          locationName: '',
          businessName: thread.businessProfile.name ?? 'the business',
          startTime: undefined as unknown as Date,
          reason: preview,
        },
        appointmentId: thread.appointmentId ?? undefined,
      });
    }
  }

  // ---------- Read state ----------

  async markRead(
    userId: string,
    threadId: string,
    role: UserRole,
  ): Promise<ThreadReadDto> {
    await this.requireParticipant(userId, threadId, role);

    const now = new Date();
    await this.prisma.threadReadState.upsert({
      where: { threadId_userId: { threadId, userId } },
      update: { lastReadAt: now },
      create: { threadId, userId, lastReadAt: now },
    });

    return { message: 'Thread marked as read.', lastReadAt: now.toISOString() };
  }

  // ---------- Access ----------

  /**
   * The set of threads this caller may see.
   *
   * Structural, like every other ownership rule here: the scope goes into the
   * WHERE clause, so someone else's thread simply never matches rather than
   * being loaded and then rejected.
   */
  private async participantScope(
    userId: string,
    role: UserRole,
  ): Promise<Prisma.ThreadWhereInput> {
    // Explicitly enumerated rather than "customer, else business". A string
    // compared against a literal falls through on any unexpected value, and
    // here the fall-through led to the WIDER scope — a whole business's
    // threads. Same fix as AppointmentsService.findAll.
    if (role === UserRole.CUSTOMER) return { customerId: userId };

    if (role === UserRole.BUSINESS) {
      const membership = await this.prisma.businessMembership.findFirst({
        where: { userId, status: BusinessMemberStatus.ACTIVE },
        select: { businessProfileId: true },
      });

      // No active membership means no threads — not an error, just an empty
      // scope that matches nothing.
      if (!membership) return { id: '__none__' };
      return { businessProfileId: membership.businessProfileId };
    }

    throw new ForbiddenException('This account type cannot access chat threads.');
  }

  /**
   * Public participation check, for callers outside this service.
   *
   * Exists so ChatGateway can authorise a room join using the SAME rule the
   * REST endpoints use, rather than growing its own copy. Delegates straight to
   * requireParticipant and throws the same NotFoundException.
   */
  async assertParticipant(userId: string, threadId: string, role: UserRole) {
    return this.requireParticipant(userId, threadId, role);
  }

  private async requireParticipant(
    userId: string,
    threadId: string,
    role: UserRole,
  ): Promise<ThreadRecord> {
    const scope = await this.participantScope(userId, role);
    const thread = await this.prisma.thread.findFirst({
      where: { AND: [{ id: threadId }, scope] },
      select: THREAD_SELECT,
    });

    // 404, not 403: confirming a thread exists but belongs to someone else is
    // itself a small leak, the same reasoning used throughout (§10.7).
    if (!thread) throw new NotFoundException('Thread not found.');
    return thread;
  }

  private async loadThread(threadId: string, viewerId: string) {
    const thread = await this.prisma.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: THREAD_SELECT,
    });
    return this.decorate(thread, viewerId);
  }

  /** Adds the viewer's own unread count and a last-message preview. */
  private async decorate(
    thread: ThreadRecord,
    viewerId: string,
  ): Promise<ThreadDto> {
    const readState = await this.prisma.threadReadState.findUnique({
      where: { threadId_userId: { threadId: thread.id, userId: viewerId } },
      select: { lastReadAt: true },
    });

    const [unreadCount, lastMessage] = await Promise.all([
      this.prisma.message.count({
        where: {
          threadId: thread.id,
          // Never count your own messages as unread.
          senderId: { not: viewerId },
          ...(readState ? { createdAt: { gt: readState.lastReadAt } } : {}),
        },
      }),
      this.prisma.message.findFirst({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'desc' },
        select: { body: true, photoUrl: true, createdAt: true, senderId: true },
      }),
    ]);

    return {
      id: thread.id,
      kind: thread.appointmentId ? ('APPOINTMENT' as const) : ('INQUIRY' as const),
      business: {
        id: thread.businessProfile.id,
        name: thread.businessProfile.name,
        logoUrl: thread.businessProfile.logoUrl,
      },
      customer: thread.customer,
      appointment: thread.appointment
        ? {
            id: thread.appointment.id,
            status: thread.appointment.status,
            startTime: thread.appointment.startTime.toISOString(),
            serviceName: thread.appointment.service.name,
          }
        : null,
      unreadCount,
      lastMessage: lastMessage
        ? {
            preview: lastMessage.body ?? (lastMessage.photoUrl ? '[photo]' : ''),
            hasPhoto: Boolean(lastMessage.photoUrl),
            senderId: lastMessage.senderId,
            createdAt: lastMessage.createdAt.toISOString(),
          }
        : null,
      lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
      createdAt: thread.createdAt.toISOString(),
    };
  }
}

const THREAD_SELECT = {
  id: true,
  customerId: true,
  businessProfileId: true,
  appointmentId: true,
  lastMessageAt: true,
  createdAt: true,
  // The logo too (§164): a list of conversations is a list of faces.
  businessProfile: { select: { id: true, name: true, logoUrl: true } },
  customer: { select: { id: true, email: true } },
  appointment: {
    select: {
      id: true,
      status: true,
      startTime: true,
      service: { select: { name: true } },
    },
  },
} as const;

type ThreadRecord = Prisma.ThreadGetPayload<{ select: typeof THREAD_SELECT }>;
