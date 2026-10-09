import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { tokens } from './api/client';
import type { Message, MessagePage } from './api/chat';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4100';

/**
 * Live messages for one open thread.
 *
 * Receiving is the socket's job and sending is not (§22.2): a message is POSTed
 * over REST exactly as before, and this only learns about the OTHER side's.
 * That split is deliberate — accepting messages over two transports would mean
 * two paths that have to agree forever.
 *
 * The token rides in the handshake `auth` payload, never the query string: URLs
 * end up in access logs, proxy logs and history, and an access token in any of
 * those outlives the connection (§22.3).
 *
 * Everything this does not do is on purpose. There is no offline queue and no
 * optimistic insert — the thread is also polled, so a message the socket misses
 * arrives within a few seconds anyway. A phone that sleeps, changes network or
 * loses signal is the normal case here, and a socket is a speed-up on top of a
 * list that is correct without it, never the thing the screen depends on.
 */
export function useThreadSocket(threadId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!threadId || !tokens.access) return;

    const socket: Socket = io(`${BASE_URL}/chat`, {
      auth: { token: tokens.access },
      transports: ['websocket'],
      // The default would also try HTTP long-polling first, which on a phone
      // means an extra round trip before every reconnect.
      forceNew: true,
    });

    socket.on('connect', () => socket.emit('thread:join', { threadId }));

    socket.on('message:new', (message: Message) => {
      queryClient.setQueryData<MessagePage>(['messages', threadId], (page) => {
        if (!page) return page;
        // The sender's own POST already put it there, and a reconnect can
        // replay. Appending blindly would double every message you sent.
        if (page.messages.some((m) => m.id === message.id)) return page;
        return { ...page, total: page.total + 1, messages: [...page.messages, message] };
      });
      // The list's preview and unread count move with it.
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    });

    return () => {
      socket.emit('thread:leave', { threadId });
      socket.disconnect();
    };
  }, [threadId, queryClient]);
}
