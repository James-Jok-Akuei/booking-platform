import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, requestOtp } from '../api/client';
import { getMe, getReadiness, publishedLegal, wallPlaces, type LegalDocument } from '../api/business';
import { CodeBoxes, type CodeState } from '../ui/CodeBoxes';
import { Icon, type IconName } from '../ui/Icon';
import { NetworkMark } from '../ui/NetworkMark';
import { Panel } from '../ui/Panel';
import { RwandaFlag } from '../ui/RwandaFlag';
import { AuthWall } from './AuthWall';
import { Moments } from './Moments';
import { RotatingWord } from './RotatingWord';
import { useAuth } from './auth-context';
import { looksLikeEmail, suggestEmail } from './email';
import './login.css';
import { accessOf } from '../access';

/** What the headline says a seller can grow, one after another. */
const WORDS = ['barbershop.', 'salon.', 'spa.', 'garage.', 'nail studio.', 'photo studio.'];
/** The server's own wait between codes (`OTP_RESEND_COOLDOWN_SECONDS`). */
const RESEND_SECONDS = 60;
/** How long a code works (`OTP_EXPIRES_IN_MINUTES`). */
const CODE_MINUTES = 10;

type Step = 'email' | 'register' | 'code' | 'done';
type DocumentKind = LegalDocument['kind'];

const DOCUMENT_NAME: Record<DocumentKind, string> = {
  TERMS_OF_USE: 'Terms of Use',
  PRIVACY_POLICY: 'Privacy Policy',
  SELLER_AGREEMENT: 'Seller Agreement',
};

/** The server's sentences, said the way a person would (§183). */
function friendly(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiError)) return fallback;
  const m = caught.message;
  if (/invalid or expired/i.test(m)) return 'That code is not right, or it has run out. Check it and try again.';
  if (/too many incorrect/i.test(m)) return 'Too many wrong tries. Ask for a new code below.';
  if (/too many verification code requests/i.test(m))
    return 'That is a lot of codes for one hour. Please try again a little later.';
  return m;
}

/**
 * Signing in, and signing up, as one short conversation (§238) — the
 * customer app's (§183), made for a seller and for a bigger screen.
 *
 * The rules underneath are unchanged (§50, §90.3, §126): ONE email box for
 * everybody, and no role sent unless somebody new asks to join. The server
 * is asked for a code; an address with an account gets one at once, and an
 * address without one is a new business — welcomed, shown what the account
 * is for, asked to tick that they agree to the three documents (opened from
 * right here, before ticking), and the same code then creates the account.
 * No password anywhere.
 *
 * On a computer the shops' photos fill the left of the screen under the
 * headline, and a white sheet on the right asks one question at a time. On a
 * phone it is the customer app's screen: the wall on top, the sheet rising
 * over it, and the wall folding to a strip while the keyboard is up.
 */
export function LoginPage() {
  const { user, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const next = from && from !== '/login' ? from : '/';
  // What the landing page's buttons asked for (§258): "Start selling" or
  // "Sign in". Only the words change — one email box serves both, and the
  // server still decides who is new (§50).
  const start = new URLSearchParams(location.search).get('start');
  const queryClient = useQueryClient();
  // Somebody already signed in has nothing to do here — judged as they
  // arrive only: signing in on this page sets the user too, and the "You
  // are in" moment has to play before leaving.
  const [arrivedSignedIn] = useState(() => user?.role === 'BUSINESS');
  // A session that is not a business's (left from before this screen signed
  // such sessions back out) has no place in this app: closed quietly.
  useEffect(() => {
    if (user && user.role !== 'BUSINESS') void signOut();
    // Only as the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<CodeState>('idle');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [reading, setReading] = useState<DocumentKind | null>(null);

  const clean = email.trim().toLowerCase();
  const valid = looksLikeEmail(clean);
  const suggestion = suggestEmail(clean);

  // Timers that outlive a press — the pause before leaving — are cleared if
  // the page goes first, so nothing navigates from a page that has gone.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // "Send a new code" waits as long as the server does.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Ready to type on a computer. Not on a phone, where it would open the
  // keyboard over the wall before anyone has looked at it.
  const emailBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 'email' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) emailBox.current?.focus();
  }, [step]);

  // The documents, fetched once somebody is about to agree to them.
  const documents = useQuery({
    queryKey: ['legal-published'],
    queryFn: publishedLegal,
    enabled: step === 'register' || reading !== null,
    staleTime: 10 * 60_000,
  });

  // The wall leans a little away from the pointer: depth, not a gimmick.
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

  /** Asks for a code. `role` only when somebody new has asked to join (§50). */
  const send = async (role?: 'BUSINESS') => {
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await requestOtp(clean, role);
      setIsNew(Boolean(role));
      setCode('');
      setCodeState('idle');
      setResendIn(RESEND_SECONDS);
      setStep('code');
    } catch (caught) {
      // An email with no account is not a mistake: it is somebody new — or
      // a colleague a business invited, who was told to "simply sign in"
      // and has never had an account (§90.3).
      if (caught instanceof ApiError && /no account yet/i.test(caught.message) && !role) {
        setIsNew(true);
        setStep('register');
        return;
      }
      // A code went out less than a minute ago and still works — so the
      // answer is "use that one", not an error.
      const wait = caught instanceof ApiError ? /wait (\d+)s/i.exec(caught.message) : null;
      if (wait) {
        setIsNew(Boolean(role));
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
      if (signedIn.role !== 'BUSINESS') {
        // Signed straight back out: keeping a customer's session here would
        // open the shop's pages to an account the server refuses them to.
        await signOut();
        setCodeState('error');
        setShake(true);
        setError(
          `${signedIn.email} is ${signedIn.role === 'CUSTOMER' ? 'a customer' : 'an admin'} account. This app is for businesses — sign in with your business email.`,
        );
        later(() => {
          setCode('');
          setCodeState('idle');
        }, 900);
        return;
      }
      setCodeState('ok');
      later(() => setStep('done'), 450);
      // Back where they were going, or to their day — or, for a shop still
      // to be set up, to setting it up (§256).
      const began = Date.now();
      const where = await whereNext();
      later(() => navigate(where, { replace: true }), Math.max(0, 1900 - (Date.now() - began)));
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

  /**
   * A shop nobody has finished setting up — not yet sent for review, still
   * missing something it needs — opens on setting it up (§256), for whoever
   * may do it (its owner, or a manager of every branch). Everybody else, and anybody who was
   * going somewhere in particular, goes there.
   */
  const whereNext = async () => {
    if (next !== '/') return next;
    try {
      const [readiness, me] = await Promise.all([
        queryClient.fetchQuery({ queryKey: ['readiness'], queryFn: getReadiness }),
        queryClient.fetchQuery({ queryKey: ['me'], queryFn: getMe }),
      ]);
      // The owner, or a manager of every branch (§277).
      const setUp = accessOf(me.businessMembership).runsBusiness;
      return setUp && readiness.status === 'PENDING' && readiness.submittedAt === null && !readiness.ready ? '/welcome' : '/';
    } catch {
      return '/';
    }
  };

  const typed = (value: string) => {
    setCode(value);
    if (error) setError(null);
  };

  const startAgain = () => {
    setStep('email');
    setAgreed(false);
    setCode('');
    setCodeState('idle');
    setError(null);
    setInfo(null);
  };

  if (arrivedSignedIn) return <Navigate to={next} replace />;

  // Said under the thing it is about — the field, the tick, the boxes — not
  // at the foot of the sheet.
  const problem = error ? (
    <p className="au-note is-error" role="alert" key={error}>
      <Icon name="alert" size={17} />
      <span>{error}</span>
    </p>
  ) : null;

  const open = documents.data?.find((d) => d.kind === reading) ?? null;

  return (
    <div className={`au is-${step}`} ref={root} onPointerMove={lean}>
      {/* THE WALL. */}
      <section className="au-stage">
        <AuthWall />

        <div className="au-top">
          <span className="au-brand">
            <span className="au-brand-mark">
              <Icon name="calendarCheck" size={19} />
            </span>
            For businesses
          </span>
          <span className="au-glass au-made">
            <RwandaFlag width={18} />
            Made for Rwanda
          </span>
        </div>

        <Moments />

        <div className="au-hero">
          <h2 className="au-h1" aria-label="Grow your barbershop, salon, spa or garage — bookings, deposits and check-ins in one place.">
            <span aria-hidden="true">Grow your</span>
            <RotatingWord words={WORDS} className="au-gold" />
          </h2>
          <p className="au-sub">Customers book and pay a deposit. You check them in with a code.</p>
          <Proof />
        </div>
      </section>

      {/* THE SHEET: one question at a time. */}
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
              {start === 'signup' ? (
                <>
                  <h1 className="au-title">
                    Start selling.
                    <br />
                    <span className="au-hot">Free to join.</span>
                  </h1>
                  <p className="au-lead">
                    Type your business email and we will send you a 6-digit code. It creates your account — no
                    password — and then we set up your shop together, in about five minutes.
                  </p>
                </>
              ) : start === 'signin' ? (
                <>
                  <h1 className="au-title">
                    Welcome
                    <br />
                    <span className="au-hot">back.</span>
                  </h1>
                  <p className="au-lead">
                    Type your business email and we will send you a 6-digit code to sign in.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="au-title">
                    One email.
                    <br />
                    <span className="au-hot">No password.</span>
                  </h1>
                  <p className="au-lead">
                    Type your email and we will send you a 6-digit code. New here? The same code creates your
                    business account.
                  </p>
                </>
              )}

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

              {/* "Did you mean …@gmail.com?" — offered, never applied. */}
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
                No password to remember. A fresh code every time.
              </p>
            </form>
          )}

          {step === 'register' && (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (agreed) void send('BUSINESS');
              }}
            >
              <Pill tone="accent" icon="sparkles">
                New here
              </Pill>
              <h1 className="au-title">
                Nice to <span className="au-hot">meet you.</span>
              </h1>
              <p className="au-lead">
                There is no account for <b>{clean}</b> yet. Let us make your business account — it takes one
                code, and nothing else.
              </p>

              <div className="au-perks">
                <Perk
                  mark={
                    <span className="au-perk-mark tone-coral">
                      <Icon name="calendarCheck" size={19} />
                    </span>
                  }
                  title="Get booked online"
                  text="Customers find your shop and pick a time that is free."
                />
                <Perk
                  mark={<NetworkMark network="MTN_MOMO" size={40} />}
                  title="Deposits to MTN MoMo"
                  text="A deposit holds each booking. Your share is paid to your number."
                />
                <Perk
                  mark={
                    <span className="au-perk-mark tone-blue">
                      <Icon name="ticket" size={19} />
                    </span>
                  }
                  title="Check in with a code"
                  text="Six digits at the door. If they never come, your share is still paid."
                />
              </div>

              <p className="au-invited">
                <Icon name="users" size={15} />
                <span>
                  Invited to work with a business? This makes your account — you join them when you enter the
                  code.
                </span>
              </p>

              {/* An explicit tick, not "by continuing you agree" (§126.2) —
                  and every document opens from here BEFORE it is ticked. A
                  new business agrees to the Seller Agreement too: the server
                  records all three as the account is made (§126.1). */}
              <div className={`au-agree${agreed ? ' is-on' : ''}`} onClick={() => setAgreed((was) => !was)}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={agreed}
                  aria-labelledby="au-agree-text"
                  className="au-check"
                  onClick={(event) => {
                    event.stopPropagation();
                    setAgreed((was) => !was);
                  }}
                >
                  {agreed && <Icon name="check" size={16} stroke={3} />}
                </button>
                <p id="au-agree-text">
                  I have read and agree to the <Doc kind="TERMS_OF_USE" onOpen={setReading} />, the{' '}
                  <Doc kind="PRIVACY_POLICY" onOpen={setReading} /> and the{' '}
                  <Doc kind="SELLER_AGREEMENT" onOpen={setReading} />.
                </p>
              </div>

              {problem}
              <Go busy={busy} disabled={!agreed} busyLabel="Sending your code…">
                Create my business account
              </Go>
              <button type="button" className="au-link au-centre" onClick={startAgain}>
                Use a different email
              </button>
            </form>
          )}

          {step === 'code' && (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (code.length === 6 && codeState === 'idle') void verify(code);
              }}
            >
              {isNew ? (
                <Pill tone="accent" icon="sparkles">
                  Creating your account
                </Pill>
              ) : (
                <Pill tone="ok" dot>
                  Welcome back
                </Pill>
              )}
              <h1 className="au-title">
                Check your <span className="au-hot">inbox.</span>
              </h1>
              <p className="au-lead au-lead-tight">Enter the 6-digit code we sent to</p>
              <button
                type="button"
                className="au-chip"
                onClick={startAgain}
                aria-label={`${clean}. Change the email`}
              >
                <Icon name="mail" size={15} />
                <span>{clean}</span>
                <em>Change</em>
              </button>

              <CodeBoxes
                value={code}
                onChange={typed}
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

              <Go
                busy={codeState === 'busy'}
                disabled={code.length !== 6 || codeState !== 'idle'}
                done={codeState === 'ok'}
                busyLabel="Checking…"
              >
                {codeState === 'ok' ? 'Signed in' : 'Verify'}
              </Go>

              <p className="au-resend">
                <span>Didn&rsquo;t get it?</span>
                {resendIn > 0 ? (
                  <b>Send a new one in 0:{String(resendIn).padStart(2, '0')}</b>
                ) : (
                  <button type="button" className="au-link" disabled={busy} onClick={() => void send(isNew ? 'BUSINESS' : undefined)}>
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
                {isNew ? (
                  <>
                    Welcome <span className="au-hot">aboard!</span>
                  </>
                ) : (
                  <>
                    You are <span className="au-hot">in!</span>
                  </>
                )}
              </h1>
              <p className="au-lead">
                {isNew ? 'Your business account is ready. Let us set up your shop.' : 'Good to see you again.'}
              </p>
              <span className="au-done-bar" aria-hidden="true">
                <i />
              </span>
            </div>
          )}
        </div>

        {step !== 'done' && (
          <footer className="au-legal">
            {(['TERMS_OF_USE', 'PRIVACY_POLICY', 'SELLER_AGREEMENT'] as const).map((kind, i) => (
              <span key={kind} style={{ display: 'contents' }}>
                {i > 0 && <i aria-hidden="true" />}
                <button type="button" onClick={() => setReading(kind)}>
                  {DOCUMENT_NAME[kind]}
                </button>
              </span>
            ))}
          </footer>
        )}
      </main>

      {reading && (
        <Panel
          eyebrow={open ? `Version ${open.version} · ${new Date(open.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : 'Reading'}
          title={open?.title ?? DOCUMENT_NAME[reading]}
          onClose={() => setReading(null)}
          width={680}
          footer={
            <button type="button" className="primary" onClick={() => setReading(null)}>
              Done reading
            </button>
          }
        >
          {open ? (
            <pre className="lg-body">{open.body}</pre>
          ) : documents.isError ? (
            <p className="au-note is-error">
              <Icon name="alert" size={17} />
              <span>This document could not be opened just now. Check your connection and try again.</span>
            </p>
          ) : (
            <div className="au-reading">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

/**
 * Under the headline on a wide screen: how many places already take bookings
 * here, with a few of their shops' logos — real, and counted by the server,
 * so it is never a boast. Left out until there are three.
 */
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
        <b>{total} places</b> already take bookings here
      </span>
    </p>
  );
}

/** The sheet's one big button: an arrow that leans forward, a spinner while it works. */
function Go({
  children,
  busy,
  disabled,
  done = false,
  busyLabel,
}: {
  children: ReactNode;
  busy: boolean;
  disabled: boolean;
  done?: boolean;
  busyLabel: string;
}) {
  return (
    <button type="submit" className={`au-go${done ? ' is-done' : ''}`} disabled={disabled || busy} aria-busy={busy}>
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

function Pill({ tone, icon, dot = false, children }: { tone: 'accent' | 'ok'; icon?: IconName; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`au-pill tone-${tone}`}>
      {icon && <Icon name={icon} size={15} />}
      {dot && <i />}
      {children}
    </span>
  );
}

/** One reason to have an account: a mark in its own colour, and a line about it. */
function Perk({ mark, title, text }: { mark: ReactNode; title: string; text: string }) {
  return (
    <div className="au-perk">
      {mark}
      <span className="au-perk-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
    </div>
  );
}

/** A document's name that opens it, inside the sentence agreeing to it. */
function Doc({ kind, onOpen }: { kind: DocumentKind; onOpen: (kind: DocumentKind) => void }) {
  return (
    <button
      type="button"
      className="au-doc"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(kind);
      }}
    >
      {DOCUMENT_NAME[kind]}
    </button>
  );
}
