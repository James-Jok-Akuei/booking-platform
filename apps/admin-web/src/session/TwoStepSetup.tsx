import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, TWO_STEP_SETUP, confirmTwoStep, getTwoStep, startTwoStep, type TwoStepSetup } from '../api/client';
import { useAuth } from '../auth/auth-context';
import { CodeBoxes, type CodeState } from '../ui/CodeBoxes';
import { Icon } from '../ui/Icon';
import { QrCode } from '../ui/QrCode';
import './two-step.css';

/** Apps that read the QR code — any authenticator works. */
const APPS = ['Google Authenticator', 'Microsoft Authenticator', '1Password', 'Authy'];

/**
 * Until an administrator has two-step sign-in, the console is only this
 * (§298): what it is and why, the QR code for their app, its first code, and
 * the recovery codes to keep. Shown as the console opens, and again whenever
 * the server answers TWO_STEP_SETUP_REQUIRED.
 */
export function TwoStepGate() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['two-step'], queryFn: getTwoStep, enabled: user?.role === 'ADMIN', retry: false });
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    const onAsk = () => setAsked(true);
    window.addEventListener(TWO_STEP_SETUP, onAsk);
    return () => window.removeEventListener(TWO_STEP_SETUP, onAsk);
  }, []);

  const needed = user?.role === 'ADMIN' && (asked || (status.data ? status.data.required && !status.data.enabled : false));
  if (!needed) return null;

  return (
    <div className="ts-gate" role="dialog" aria-modal="true" aria-labelledby="ts-title">
      <div className="ts-card">
        <TwoStepFlow
          onDone={() => {
            setAsked(false);
            void queryClient.invalidateQueries();
          }}
          onLeave={() => void signOut()}
          leaveLabel="Sign out"
        />
      </div>
    </div>
  );
}

type Stage = 'why' | 'scan' | 'type' | 'codes';

/**
 * The setup itself — on the gate, and in Security for moving it to a new
 * phone. Four short stages, one thing to do in each.
 */
export function TwoStepFlow({
  onDone,
  onLeave,
  leaveLabel,
  moving = false,
}: {
  onDone: () => void;
  onLeave: () => void;
  leaveLabel: string;
  /** Moving to a new phone: the intro says so. */
  moving?: boolean;
}) {
  const [stage, setStage] = useState<Stage>('why');
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [state, setState] = useState<CodeState>('idle');
  const [shake, setShake] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<'secret' | 'codes' | null>(null);

  const begin = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setSetup(await startTwoStep());
      setStage('scan');
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'That did not work. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const check = async (typed: string) => {
    setState('busy');
    setProblem(null);
    try {
      const recovery = await confirmTwoStep(typed);
      setState('ok');
      setCodes(recovery);
      window.setTimeout(() => setStage('codes'), 500);
    } catch (error) {
      setState('error');
      setShake(true);
      setCode('');
      setProblem(error instanceof ApiError ? error.message : 'That did not work. Try again.');
      window.setTimeout(() => setState('idle'), 700);
    }
  };

  const copy = (what: 'secret' | 'codes', text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const download = () => {
    const text =
      'BwanguReservations admin console — recovery codes\n\n' +
      'Each works once, in place of your authenticator app’s code.\n\n' +
      codes.join('\n') +
      '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bwangu-admin-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <div className="ts-flow">
      <ol className="ts-dots" aria-label="Steps">
        {(['why', 'scan', 'type', 'codes'] as Stage[]).map((s, i) => (
          <li key={s} className={s === stage ? 'is-on' : (['why', 'scan', 'type', 'codes'] as Stage[]).indexOf(stage) > i ? 'is-done' : ''} />
        ))}
      </ol>

      {stage === 'why' && (
        <section className="ts-stage" key="why">
          <span className="ts-mark">
            <Icon name="shield" size={28} />
          </span>
          <h2 id="ts-title">{moving ? 'Move two-step sign-in to a new phone' : 'One more lock on the console'}</h2>
          <p className="ts-lead">
            {moving
              ? 'You will scan a new code with the app on your new phone. The old phone’s codes stop working once the new one is set.'
              : 'Administrators can move money and close accounts, so signing in takes two things: the code we email you, and a code from an app on your phone. Someone who gets into your email still cannot get in here.'}
          </p>
          <ul className="ts-points">
            <li>
              <Icon name="phone" size={17} />
              <span>
                <strong>Get an authenticator app</strong> if you do not have one: {APPS.join(', ')} — any of them works.
              </span>
            </li>
            <li>
              <Icon name="timer" size={17} />
              <span>
                <strong>It takes about a minute.</strong> After this, each sign-in asks for the 6 digits the app shows.
              </span>
            </li>
          </ul>
          {problem && (
            <p className="ts-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="ts-actions">
            <button type="button" onClick={onLeave}>
              {leaveLabel}
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void begin()}>
              {busy ? 'Getting it ready…' : 'Set it up'}
              {!busy && <Icon name="arrowRight" size={16} />}
            </button>
          </div>
        </section>
      )}

      {stage === 'scan' && setup && (
        <section className="ts-stage" key="scan">
          <h2 id="ts-title">Scan this with the app</h2>
          <p className="ts-lead">In the app, choose “Add” or “+”, then “Scan a QR code”.</p>
          <div className="ts-qr">
            <QrCode text={setup.otpauthUrl} label="QR code for your authenticator app" />
          </div>
          <div className="ts-secret">
            <span>Cannot scan? Type this key in the app instead:</span>
            <button type="button" onClick={() => copy('secret', setup.secret.replace(/\s/g, ''))} title="Copy the key">
              <code>{setup.secret}</code>
              <Icon name={copied === 'secret' ? 'check' : 'copy'} size={14} />
            </button>
          </div>
          <div className="ts-actions">
            <button type="button" onClick={onLeave}>
              {leaveLabel}
            </button>
            <button type="button" className="primary" onClick={() => setStage('type')}>
              I have added it <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </section>
      )}

      {stage === 'type' && (
        <section className="ts-stage" key="type">
          <h2 id="ts-title">Type the code it shows</h2>
          <p className="ts-lead">The 6 digits under BwanguReservations. They change every 30 seconds — type the one showing now.</p>
          <div className="ts-boxes">
            <CodeBoxes
              value={code}
              onChange={(next) => {
                setCode(next);
                if (state === 'error') setState('idle');
              }}
              onComplete={(typed) => void check(typed)}
              state={state}
              shake={shake}
              onShakeEnd={() => setShake(false)}
              disabled={state === 'busy' || state === 'ok'}
              autoFocus
            />
          </div>
          {problem && (
            <p className="ts-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="ts-actions">
            <button type="button" onClick={() => setStage('scan')}>
              Back to the QR code
            </button>
          </div>
        </section>
      )}

      {stage === 'codes' && (
        <section className="ts-stage" key="codes">
          <span className="ts-mark is-ok">
            <Icon name="checkCircle" size={28} />
          </span>
          <h2 id="ts-title">It is on. Keep these codes safe.</h2>
          <p className="ts-lead">
            If you lose your phone, each of these works once in place of the app’s code. They are shown only now. Every other place you were signed in has been signed out.
          </p>
          <ol className="ts-codes">
            {codes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ol>
          <div className="ts-code-actions">
            <button type="button" onClick={download}>
              <Icon name="download" size={15} /> Download them
            </button>
            <button
              type="button"
              onClick={() => {
                copy('codes', codes.join('\n'));
                setSaved(true);
              }}
            >
              <Icon name={copied === 'codes' ? 'check' : 'copy'} size={15} /> {copied === 'codes' ? 'Copied' : 'Copy them'}
            </button>
          </div>
          <label className="ts-saved">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            <span>I have saved them somewhere safe — not only on this computer.</span>
          </label>
          <div className="ts-actions">
            <button type="button" className="primary" disabled={!saved} onClick={onDone}>
              Done <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
