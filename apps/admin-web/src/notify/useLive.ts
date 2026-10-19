import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { tokens } from '../api/client';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/**
 * The bell, live (§287): one socket for the whole app, told the moment a
 * notification is made, so the list is fetched again then instead of on the
 * next minute's check (which stays, for a connection that dropped).
 */
export function useLiveNotifications(signedIn: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!signedIn || !tokens.access) return;
    const socket = io(API_URL ? `${API_URL}/live` : '/live', {
      auth: (cb) => cb({ token: tokens.access }),
      transports: ['websocket', 'polling'],
    });
    socket.on('notification:new', () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [signedIn, queryClient]);
}
