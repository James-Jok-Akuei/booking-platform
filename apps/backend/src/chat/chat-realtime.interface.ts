/**
 * The one thing ChatService needs from the realtime layer.
 *
 * Exists to break a circular import. ChatService used to import ChatGateway
 * (for `forwardRef`) while ChatGateway imports ChatService — a cycle that
 * CommonJS tolerates but ES modules do not: under ESM the decorator metadata on
 * the gateway evaluates before ChatService is initialised, giving
 * "Cannot access 'ChatService' before initialization".
 *
 * With this token the dependency runs one way only — the gateway knows about
 * the service, the service knows only about this interface — so there is no
 * cycle to resolve and no forwardRef on either side.
 */
export interface ChatRealtimePublisher {
  /** Pushes a newly created message to everyone watching that thread. */
  emitNewMessage(threadId: string, message: unknown): void;
}

/** DI token — an interface has no runtime identity. */
export const CHAT_REALTIME = Symbol('CHAT_REALTIME');

/**
 * Used when no realtime transport is registered, so ChatService never has to
 * null-check its publisher.
 */
export const NOOP_CHAT_REALTIME: ChatRealtimePublisher = {
  emitNewMessage: () => undefined,
};
