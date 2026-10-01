import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, requestOtp } from '../api/client';
import { useAuth } from './auth-context';

/**
 * Two steps, one screen: ask for a code, then enter it.
 *
 * No role is sent. Role belongs to REGISTRATION, not authentication — an
 * existing account signs in as whoever it is, and sending a role was the bug
 * that locked every administrator out of the platform (§50).
 */
export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'email' | 'register' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestOtp(email.trim().toLowerCase());
      setStep('code');
    } catch (caught) {
      // The server answers a missing account with that sentence by name, and
      // asks for a role. An invited colleague hits this every time: they were
      // told to "simply sign in" and have never had an account (§90.3). So it
      // becomes an offer rather than a dead end.
      if (caught instanceof ApiError && /no account yet/i.test(caught.message)) {
        setStep('register');
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not send a code.');
      }
    } finally {
      setBusy(false);
    }
  };

  /** Registration, which is the only place a role is ever sent. */
  const createAccount = async () => {
    setError(null);
    setBusy(true);
    try {
      await requestOtp(email.trim().toLowerCase(), 'BUSINESS');
      setStep('code');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send a code.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await signIn(email.trim().toLowerCase(), code.trim());

      // Checked here only to explain the situation. The real enforcement is on
      // the server, which refuses every /business route to anyone else.
      if (user.role !== 'BUSINESS') {
        setError(
          `This app is for businesses, and ${user.email} is a ${user.role.toLowerCase()} account.`,
        );
        return;
      }
      navigate('/appointments', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centred">
      <form
        className="card auth"
        onSubmit={
          step === 'email'
            ? submitEmail
            : step === 'register'
              ? (event) => {
                  event.preventDefault();
                  void createAccount();
                }
              : submitCode
        }
      >
        <h1>Business sign-in</h1>

        {step === 'email' ? (
          <>
            <p className="muted">
              We will email you a six-digit code. There is no password.
            </p>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
            <button type="submit" disabled={busy || email.trim() === ''}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        ) : step === 'register' ? (
          <>
            <p className="muted">
              There is no account for <strong>{email}</strong> yet.
            </p>
            <p className="muted">
              If a business invited you to work with them, this is the step that
              creates your account. You will get a six-digit code, and joining
              happens when you enter it.
            </p>
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Create a business account'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setStep('email');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Enter the code sent to <strong>{email}</strong>.
            </p>
            <label htmlFor="code">Six-digit code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
            <button type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different address
            </button>
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </div>
  );
}
