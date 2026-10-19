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
  ACCESS_KEY,
  ACTIVE_KEY,
  SESSION_ENDED,
  forgetWhy,
  logout as apiLogout,
  rememberWhy,
  tokens,
  verifyOtp,
  type AuthenticatedUser,
  type SignedOutWhy,
} from '../api/client';

interface AuthState {
  user: AuthenticatedUser | null;
  signIn: (email: string, code: string, twoStepCode?: string) => Promise<AuthenticatedUser>;
  /** `why`, when the app ended it for safety (§279), is said on the sign-in page. */
  signOut: (why?: SignedOutWhy['why']) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const USER_KEY = 'booking-admin.user';

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
      setUser(null);
    };
    window.addEventListener(SESSION_ENDED, onEnded);
    return () => window.removeEventListener(SESSION_ENDED, onEnded);
  }, []);

  // Every tab of the app is one sign-in (§279): signing out in one signs out
  // all of them, and signing in in one signs in the others.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_KEY && event.newValue === null) {
        localStorage.removeItem(USER_KEY);
        setUser(null);
      }
      if (event.key === USER_KEY && event.newValue) setUser(JSON.parse(event.newValue) as AuthenticatedUser);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const signIn = useCallback(async (email: string, code: string, twoStepCode?: string) => {
    const result = await verifyOtp(email, code, twoStepCode);
    tokens.save(result);
    // A new sign-in starts its idle clock now, and the old reason is spent.
    localStorage.setItem(ACTIVE_KEY, String(Date.now()));
    forgetWhy();
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setUser(result.user);
    return result.user;
  }, []);

  const signOut = useCallback(async (why?: SignedOutWhy['why']) => {
    if (why) rememberWhy(why);
    await apiLogout();
    localStorage.removeItem(USER_KEY);
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
