import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { tokens, useSignedIn } from './api/client';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4100';

/**
 * The bell, live (§287): one socket while signed in, told the moment a
 * notification is made, so the badge moves then rather than on the next
 * minute's check (which stays, for a connection that dropped).
 */
export function useLiveNotifications() {
  const signedIn = useSignedIn();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!signedIn || !tokens.access) return;
    const socket = io(`${BASE_URL}/live`, {
      auth: (cb) => cb({ token: tokens.access }),
      transports: ['websocket'],
    });
    socket.on('notification:new', () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [signedIn, queryClient]);
}
