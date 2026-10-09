import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, requestOtp } from '../api/client';
import { wallPlaces } from '../api/admin';
import { CodeBoxes, type CodeState } from '../ui/CodeBoxes';
import { Icon, type IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { RwandaFlag } from '../ui/RwandaFlag';
import { AuthWall } from './AuthWall';
import { Moments } from './Moments';
import { RotatingWord } from './RotatingWord';
import { useAuth } from './auth-context';
import { looksLikeEmail, suggestEmail } from './email';
import './login.css';

/** What an administrator looks after, one after another. */
const WORDS = ['shop.', 'booking.', 'payout.', 'review.', 'ticket.'];
/** The server's own wait between codes (`OTP_RESEND_COOLDOWN_SECONDS`). */
const RESEND_SECONDS = 60;
/** How long a code works (`OTP_EXPIRES_IN_MINUTES`). */
const CODE_MINUTES = 10;

type Step = 'email' | 'not-invited' | 'code' | 'done';

/** The server's sentences, said the way a person would (§183). */
function friendly(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiError)) return fallback;
  const m = caught.message;
  if (/invalid or expired/i.test(m)) return 'That code is not right, or it has run out. Check it and try again.';
  if (/too many incorrect/i.test(m)) return 'Too many wrong tries. Ask for a new code below.';
  if (/too many verification code requests/i.test(m)) return 'That is a lot of codes for one hour. Please try again a little later.';
  return m;
}

/**
 * Signing in to the console (§254) — the business app's sign-in (§238) for the
 * people who look after the platform, with one difference that matters: there
 * is **no signing up**. Administrators are invited (§99): an invited address
 * simply asks for a code, and the invitation is what lets the code go out; the
 * first code makes the account. So an address with no account here is not
 * somebody new to welcome — it is somebody not invited, told so plainly.
 *
 * No role is ever sent (§50). An account that turns out not to be an
 * administrator's is signed straight back out, with why — the server refuses
 * every /admin route to it anyway.
 *
 * On a computer the shops' photos fill the left under the headline, and a
 * white sheet on the right asks one question at a time; on a phone the sheet
 * rises over the wall.
 */
export function LoginPage() {
  const { user, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const next = from && from !== '/login' ? from : '/';
  // Somebody already signed in has nothing to do here — judged as they
  // arrive only, so the "You are in" moment can play after signing in.
  const [arrivedSignedIn] = useState(() => user?.role === 'ADMIN');
  useEffect(() => {
    if (user && user.role !== 'ADMIN') void signOut();
    // Only as the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<CodeState>('idle');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const clean = email.trim().toLowerCase();
  const valid = looksLikeEmail(clean);
  const suggestion = suggestEmail(clean);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const emailBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 'email' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) emailBox.current?.focus();
  }, [step]);

  // The wall leans a little away from the pointer.
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const lean = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const x = event.clientX / window.innerWidth - 0.5;
    const y = event.clientY / window.innerHeight - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      root.current?.style.setProperty('--mx', x.toFixed(3));
      root.current?.style.setProperty('--my', y.toFixed(3));
    });
  };

  const send = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await requestOtp(clean);
      setCode('');
      setCodeState('idle');
      setResendIn(RESEND_SECONDS);
      setStep('code');
    } catch (caught) {
      // No account and no invitation: not somebody new, somebody not invited.
      if (caught instanceof ApiError && /no account yet/i.test(caught.message)) {
        setStep('not-invited');
        return;
      }
      // A code went out less than a minute ago and still works.
      const wait = caught instanceof ApiError ? /wait (\d+)s/i.exec(caught.message) : null;
      if (wait) {
        setCode('');
        setCodeState('idle');
        setResendIn(Number(wait[1]));
        setInfo('We sent you a code a moment ago. Enter that one.');
        setStep('code');
        return;
      }
      setError(friendly(caught, 'Could not send a code. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (entered: string) => {
    setError(null);
    setInfo(null);
    setCodeState('busy');
    try {
      const signedIn = await signIn(clean, entered);
      if (signedIn.role !== 'ADMIN') {
        await signOut();
        setCodeState('error');
        setShake(true);
        setError(
          `${signedIn.email} is ${signedIn.role === 'CUSTOMER' ? 'a customer' : 'a business'} account. This console is for administrators — sign in with the address you were invited at.`,
        );
        later(() => {
          setCode('');
          setCodeState('idle');
        }, 900);
        return;
      }
      setCodeState('ok');
      later(() => setStep('done'), 450);
      later(() => navigate(next, { replace: true }), 1700);
    } catch (caught) {
      setCodeState('error');
      setShake(true);
      setError(friendly(caught, 'That code did not work. Please try again.'));
      later(() => {
        setCode('');
        setCodeState('idle');
      }, 700);
    }
  };

  const startAgain = () => {
    setStep('email');
    setCode('');
    setCodeState('idle');
    setError(null);
    setInfo(null);
  };

  if (arrivedSignedIn) return <Navigate to={next} replace />;

  const problem = error ? (
    <p className="au-note is-error" role="alert" key={error}>
      <Icon name="alert" size={17} />
      <span>{error}</span>
    </p>
  ) : null;

  return (
    <div className={`au is-${step === 'not-invited' ? 'register' : step}`} ref={root} onPointerMove={lean}>
      <section className="au-stage">
        <AuthWall />

        <div className="au-top">
          <span className="au-brand">
            <span className="au-brand-mark is-logo">
              <Logo size={40} />
            </span>
            <span className="au-brand-name">
              <span>
                Bwangu<b>Reservations</b>
              </span>
              <em>Admin console</em>
            </span>
          </span>
          <span className="au-glass au-made">
            <RwandaFlag width={18} />
            Made for Rwanda
          </span>
        </div>

        <Moments />

        <div className="au-hero">
          <h2 className="au-h1" aria-label="Look after every shop, booking, payout, review and ticket.">
            <span aria-hidden="true">Look after every</span>
            <RotatingWord words={WORDS} className="au-gold" />
          </h2>
          <p className="au-sub">Approve shops, settle disputes and send payouts — the platform’s back office, in one place.</p>
          <Proof />
        </div>
      </section>

      <main className="au-sheet">
        <div className="au-step" key={step}>
          {step === 'email' && (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (valid) void send();
              }}
              noValidate
            >
              <Pill tone="night" icon="shield">
                Administrators only
              </Pill>
              <h1 className="au-title">
                Sign in to
                <br />
                <span className="au-hot">the console.</span>
              </h1>
              <p className="au-lead">Type the email you were invited at, and we will send you a 6-digit code. There is no password.</p>

              <label className="au-field">
                <span className="au-field-icon">
                  <Icon name="mail" size={18} />
                </span>
                <input
                  ref={emailBox}
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="you@example.com"
                  aria-label="Email address"
                />
                {valid && (
                  <span className="au-field-ok" aria-hidden="true">
                    <Icon name="checkCircle" size={22} stroke={2.2} />
                  </span>
                )}
              </label>

              {suggestion && (
                <button type="button" className="au-suggest" onClick={() => setEmail(suggestion)}>
                  <Icon name="bulb" size={16} />
                  <span>
                    Did you mean <b>{suggestion}</b>?
                  </span>
                  <em>Fix</em>
                </button>
              )}

              {problem}
              <Go busy={busy} disabled={!valid} busyLabel="Sending your code…">
                Continue
              </Go>

              <p className="au-foot">
                <Icon name="lock" size={14} />
                No sign-up here: administrators are invited by email.
              </p>
            </form>
          )}

          {step === 'not-invited' && (
            <div className="au-form">
              <Pill tone="accent" icon="lock">
                Not invited
              </Pill>
              <h1 className="au-title">
                No account for <span className="au-hot">this address.</span>
              </h1>
              <p className="au-lead">
                There is no administrator account for <b>{clean}</b>, and no invitation waiting for it.
              </p>
              <div className="au-perks">
                <Perk icon="mail" tone="coral" title="Administrators are invited" text="The primary administrator sends an invitation from Users, in the console." />
                <Perk icon="checkCircle" tone="green" title="Then simply sign in here" text="With the address the invitation went to — the first code makes your account." />
                <Perk icon="info" tone="blue" title="Invited already?" text="The invitation may have run out, or gone to another address. Ask for a new one." />
              </div>
              <Go type="button" busy={false} disabled={false} busyLabel="" onClick={startAgain}>
                Use a different email
              </Go>
            </div>
          )}

          {step === 'code' && (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (code.length === 6 && codeState === 'idle') void verify(code);
              }}
            >
              <Pill tone="ok" dot>
                Code sent
              </Pill>
              <h1 className="au-title">
                Check your <span className="au-hot">inbox.</span>
              </h1>
              <p className="au-lead au-lead-tight">Enter the 6-digit code we sent to</p>
              <button type="button" className="au-chip" onClick={startAgain} aria-label={`${clean}. Change the email`}>
                <Icon name="mail" size={15} />
                <span>{clean}</span>
                <em>Change</em>
              </button>

              <CodeBoxes
                value={code}
                onChange={(value) => {
                  setCode(value);
                  if (error) setError(null);
                }}
                onComplete={(value) => codeState === 'idle' && void verify(value)}
                state={codeState}
                shake={shake}
                onShakeEnd={() => setShake(false)}
                disabled={codeState === 'busy' || codeState === 'ok'}
                autoFocus
              />

              {problem}
              {info && (
                <p className="au-note is-info" role="status">
                  <Icon name="info" size={17} />
                  <span>{info}</span>
                </p>
              )}

              <Go busy={codeState === 'busy'} disabled={code.length !== 6 || codeState !== 'idle'} done={codeState === 'ok'} busyLabel="Checking…">
                {codeState === 'ok' ? 'Signed in' : 'Verify'}
              </Go>

              <p className="au-resend">
                <span>Didn&rsquo;t get it?</span>
                {resendIn > 0 ? (
                  <b>Send a new one in 0:{String(resendIn).padStart(2, '0')}</b>
                ) : (
                  <button type="button" className="au-link" disabled={busy} onClick={() => void send()}>
                    {busy ? 'Sending…' : 'Send a new code'}
                  </button>
                )}
              </p>
              <p className="au-small">Look in your spam folder too. Each code works for {CODE_MINUTES} minutes.</p>
            </form>
          )}

          {step === 'done' && (
            <div className="au-done" role="status">
              <span className="au-done-ring">
                <span className="au-done-disc">
                  <svg viewBox="0 0 24 24" width="46" height="46" aria-hidden="true">
                    <path d="M5 12.5l4.2 4.2L19 7" />
                  </svg>
                </span>
              </span>
              <h1 className="au-title">
                You are <span className="au-hot">in!</span>
              </h1>
              <p className="au-lead">Opening what needs you.</p>
              <span className="au-done-bar" aria-hidden="true">
                <i />
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** How many places take bookings, with a few of their logos — counted by the server. */
function Proof() {
  const places = useQuery({ queryKey: ['auth-wall-places'], queryFn: wallPlaces, staleTime: 10 * 60_000, retry: false });
  const total = places.data?.total ?? 0;
  if (total < 3) return null;
  const logos: Array<{ id: string; src: string }> = [];
  for (const place of places.data?.locations ?? []) {
    const src = place.business.logoUrl;
    if (src && !logos.some((l) => l.id === place.business.id)) logos.push({ id: place.business.id, src });
  }
  return (
    <p className="au-proof">
      {logos.length > 0 && (
        <span className="au-proof-logos" aria-hidden="true">
          {logos.slice(0, 4).map((logo) => (
            <img key={logo.id} src={logo.src} alt="" />
          ))}
        </span>
      )}
      <span>
        <b>{total} places</b> take bookings on the platform
      </span>
    </p>
  );
}

function Go({
  children,
  busy,
  disabled,
  done = false,
  busyLabel,
  type = 'submit',
  onClick,
}: {
  children: ReactNode;
  busy: boolean;
  disabled: boolean;
  done?: boolean;
  busyLabel: string;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  return (
    <button type={type} className={`au-go${done ? ' is-done' : ''}`} disabled={disabled || busy} aria-busy={busy} onClick={onClick}>
      {busy ? (
        <>
          <span className="au-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : done ? (
        <>
          <Icon name="checkCircle" size={19} stroke={2.2} />
          {children}
        </>
      ) : (
        <>
          {children}
          <Icon name="arrowRight" size={18} stroke={2.4} />
        </>
      )}
    </button>
  );
}

function Pill({ tone, icon, dot = false, children }: { tone: 'accent' | 'ok' | 'night'; icon?: IconName; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`au-pill tone-${tone}`}>
      {icon && <Icon name={icon} size={15} />}
      {dot && <i />}
      {children}
    </span>
  );
}

function Perk({ icon, tone, title, text }: { icon: IconName; tone: string; title: string; text: string }) {
  return (
    <div className="au-perk">
      <span className={`au-perk-mark tone-${tone}`}>
        <Icon name={icon} size={19} />
      </span>
      <span className="au-perk-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
    </div>
  );
}
