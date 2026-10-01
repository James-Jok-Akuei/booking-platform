import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth-context';

/**
 * Keeps unauthenticated people out of the app shell.
 *
 * Presentation only. This decides what to RENDER; it does not protect
 * anything — every admin endpoint is guarded on the server and asserts the role
 * again in the service (§27.1). Removing this would make the app ugly, not
 * insecure.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
