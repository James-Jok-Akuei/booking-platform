import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { tokens } from './api/client';
import type { Message } from './api/chat';

/**
 * In development this is undefined and the socket connects to THIS origin, which
 * Vite proxies to the backend with `ws: true` — the same one-origin trick the
 * REST client uses to keep CORS out of the picture locally. In production
 * `VITE_API_URL` names the real backend.
 */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/**
 * Live messages for the thread currently open in the inbox.
 *
 * Receiving only (§22.2). Sending stays REST, because creating a message is the
 * side that carries real logic — the empty-message rule, the length limit, the
 * photo upload, the notification debounce — and two transports accepting
 * messages would be two paths that have to agree forever.
 *
 * One deliberate asymmetry with the customer app: the pushed payload carries
 * the NARROW sender shape, without the email, because one socket room holds
 * both sides and a single payload cannot be tailored per viewer (§112.1). The
 * poll underneath fills in the fuller shape on its next pass, so a reply shows
 * instantly and gains its byline a moment later.
 */
export function useThreadSocket(threadId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!threadId || !tokens.access) return;

    const socket: Socket = io(API_URL ? `${API_URL}/chat` : '/chat', {
      auth: { token: tokens.access },
      forceNew: true,
    });

    socket.on('connect', () => socket.emit('thread:join', { threadId }));

    socket.on('message:new', (message: Message) => {
      queryClient.setQueryData<{ total: number; messages: Message[] }>(
        ['thread-messages', threadId],
        (page) => {
          if (!page) return page;
          // A reconnect can replay, and the sender's own POST already appended
          // it. Without this check every message you send appears twice.
          if (page.messages.some((m) => m.id === message.id)) return page;
          return { ...page, total: page.total + 1, messages: [...page.messages, message] };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    });

    return () => {
      socket.emit('thread:leave', { threadId });
      socket.disconnect();
    };
  }, [threadId, queryClient]);
}
