import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  SESSION_ENDED,
  logout as apiLogout,
  tokens,
  verifyOtp,
  type AuthenticatedUser,
} from '../api/client';
import { showStripAgain } from '../ads/stripHidden';

interface AuthState {
  user: AuthenticatedUser | null;
  signIn: (email: string, code: string) => Promise<AuthenticatedUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const USER_KEY = 'booking-business.user';

/**
 * Who is signed in.
 *
 * The user is cached alongside the tokens so a reload does not flash a login
 * screen before deciding. It is a CONVENIENCE, never an authority: every
 * request is authorised by the token, and the server decides. If this cache
 * were ever wrong, the worst it could do is render a menu item whose endpoint
 * then returns 403.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(() => {
    if (!tokens.access) return null;
    const cached = localStorage.getItem(USER_KEY);
    return cached ? (JSON.parse(cached) as AuthenticatedUser) : null;
  });

  // The client fires this when a refresh has definitively failed. Without it,
  // an expired session would leave the app rendering pages whose every query
  // fails, rather than returning the person to the login screen.
  useEffect(() => {
    const onEnded = () => {
      localStorage.removeItem(USER_KEY);
      showStripAgain();
      setUser(null);
    };
    window.addEventListener(SESSION_ENDED, onEnded);
    return () => window.removeEventListener(SESSION_ENDED, onEnded);
  }, []);

  const signIn = useCallback(async (email: string, code: string) => {
    const result = await verifyOtp(email, code);
    tokens.save(result);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    // A new sign-in brings back the "For you" banner a seller closed (§223).
    showStripAgain();
    setUser(result.user);
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    localStorage.removeItem(USER_KEY);
    showStripAgain();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
