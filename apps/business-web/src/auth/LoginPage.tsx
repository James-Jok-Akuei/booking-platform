import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, requestOtp } from '../api/client';
import { CodeBoxes } from '../ui/CodeBoxes';
import { Icon, type IconName } from '../ui/Icon';
import { useAuth } from './auth-context';
import './login.css';

/**
 * Signing in (§203): an email, then the six-digit code — no password.
 *
 * No role is sent. Role belongs to REGISTRATION, not authentication — an
 * existing account signs in as whoever it is, and sending a role was the bug
 * that locked every administrator out of the platform (§50).
 *
 * The left half shows what the app is for, as the cards a seller will see
 * inside it; the right half is the form, one step at a time.
 */
export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'email' | 'register' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  // Registering asks for the code with the role; a resend has to ask the same way.
  const [registering, setRegistering] = useState(false);
  const [resent, setResent] = useState(false);

  const address = email.trim().toLowerCase();

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestOtp(address);
      setRegistering(false);
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
      await requestOtp(address, 'BUSINESS');
      setRegistering(true);
      setStep('code');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send a code.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setResent(false);
    try {
      await requestOtp(address, registering ? 'BUSINESS' : undefined);
      setResent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send a code.');
    }
  };

  const submitCode = async (value = code) => {
    setError(null);
    setBusy(true);
    try {
      const user = await signIn(address, value.trim());

      // Checked here only to explain the situation. The real enforcement is on
      // the server, which refuses every /business route to anyone else.
      if (user.role !== 'BUSINESS') {
        setError(`This app is for businesses, and ${user.email} is a ${user.role.toLowerCase()} account.`);
        return;
      }
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
      setShake(true);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setStep('email');
    setCode('');
    setError(null);
    setResent(false);
  };

  return (
    <div className="lgn">
      <aside className="lgn-art" aria-hidden="true">
        <div className="lgn-brand">
          <span className="lgn-mark">
            <Icon name="calendarCheck" size={20} />
          </span>
          For businesses
        </div>

        <div className="lgn-stage">
          <FloatCard className="c1" icon="ticket" tone="coral" title="Next up · 10:30" text="Haircut · 2 people" />
          <FloatCard className="c2" icon="wallet" tone="green" title="Ready to send" text="Paid to your mobile money" big="RWF 9,400" />
          <FloatCard className="c3" icon="star" tone="gold" title="New review" text="“Quick, friendly and exactly what I asked for.”" />
          <FloatCard className="c4" icon="checkCircle" tone="night" title="Checked in" text="Code 4 8 2 · 1 9 0" />
        </div>

        <div className="lgn-copy">
          <h2>
            Your bookings, your customers <br />
            and your money — <span>in one place.</span>
          </h2>
          <ul>
            <li>
              <Icon name="check" size={15} stroke={2.6} /> Check customers in with their six-digit code
            </li>
            <li>
              <Icon name="check" size={15} stroke={2.6} /> Deposits paid to your mobile money
            </li>
            <li>
              <Icon name="check" size={15} stroke={2.6} /> Reply to messages and reviews
            </li>
          </ul>
        </div>
      </aside>

      <main className="lgn-side">
        <div className="lgn-box" key={step}>
          <div className="lgn-steps" aria-hidden="true">
            <i className="is-on" />
            <i className={step === 'code' ? 'is-on' : ''} />
          </div>

          {step === 'email' && (
            <form onSubmit={submitEmail}>
              <h1>Business sign-in</h1>
              <p className="lgn-lead">We will email you a six-digit code. There is no password.</p>
              <label htmlFor="email">Email address</label>
              <div className="lgn-field">
                <Icon name="mail" size={18} />
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
              </div>
              <button type="submit" className="primary lgn-go" disabled={busy || email.trim() === ''}>
                {busy ? 'Sending…' : 'Send code'}
                {!busy && <Icon name="arrowRight" size={18} stroke={2.2} />}
              </button>
            </form>
          )}

          {step === 'register' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createAccount();
              }}
            >
              <span className="lgn-icon">
                <Icon name="sparkles" size={24} />
              </span>
              <h1>New here?</h1>
              <p className="lgn-lead">
                There is no account for <strong>{email}</strong> yet.
              </p>
              <p className="lgn-note">
                If a business invited you to work with them, this is the step that creates your account. You
                will get a six-digit code, and joining happens when you enter it.
              </p>
              <button type="submit" className="primary lgn-go" disabled={busy}>
                {busy ? 'Sending…' : 'Create a business account'}
              </button>
              <button type="button" className="link lgn-back" onClick={back}>
                Use a different email
              </button>
            </form>
          )}

          {step === 'code' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitCode();
              }}
            >
              <span className="lgn-icon">
                <Icon name="mail" size={24} />
              </span>
              <h1>Check your inbox</h1>
              <p className="lgn-lead">
                Enter the code sent to <strong>{email}</strong>.
              </p>
              <CodeBoxes
                value={code}
                onChange={(next) => {
                  setCode(next);
                  if (error) setError(null);
                }}
                onComplete={(value) => void submitCode(value)}
                invalid={Boolean(error)}
                shake={shake}
                onShakeEnd={() => setShake(false)}
                disabled={busy}
                autoFocus
              />
              <button type="submit" className="primary lgn-go" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <div className="lgn-row">
                <button type="button" className="link" onClick={back}>
                  Use a different address
                </button>
                <button type="button" className="link" onClick={() => void resend()}>
                  {resent ? 'Sent again' : 'Send a new code'}
                </button>
              </div>
            </form>
          )}

          {error && (
            <p className="lgn-error" role="alert">
              <Icon name="alert" size={16} />
              {error}
            </p>
          )}
        </div>
        <p className="lgn-foot">
          <Icon name="shield" size={14} /> Signing in with a code means there is no password to steal.
        </p>
      </main>
    </div>
  );
}

function FloatCard({
  className,
  icon,
  tone,
  title,
  text,
  big,
}: {
  className: string;
  icon: IconName;
  tone: 'coral' | 'green' | 'gold' | 'night';
  title: string;
  text: string;
  big?: string;
}) {
  return (
    <div className={`lgn-card ${className} tone-${tone}`}>
      <span className="lgn-card-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        {big && <b>{big}</b>}
        <span>{text}</span>
      </div>
    </div>
  );
}
