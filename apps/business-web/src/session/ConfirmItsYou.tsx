import { useEffect, useRef, useState } from 'react';
import { ApiError, requestStepUp, setConfirmer, verifyStepUp } from '../api/client';
import { CodeBoxes, type CodeState } from '../ui/CodeBoxes';
import { Icon } from '../ui/Icon';
import { clock } from './words';
import './session.css';

/** As long as the server makes someone wait between codes. */
const RESEND_SECONDS = 60;

/**
 * "Confirm it is you" (§279), for the changes that move the shop's money or
 * let someone in: the payout number, and adding, removing or moving people.
 *
 * Mounted once. When the server answers such a change with STEP_UP_REQUIRED,
 * the API client asks this for a code, and the change goes through by itself
 * once it is typed — the page that made it never knows it was asked.
 */
export function ConfirmHost() {
  const [answer, setAnswer] = useState<((pass: string | null) => void) | null>(null);

  useEffect(() => {
    setConfirmer(() => new Promise<string | null>((resolve) => setAnswer(() => resolve)));
    return () => setConfirmer(null);
  }, []);

  if (!answer) return null;
  return (
    <ConfirmDialog
      onDone={(pass) => {
        answer(pass);
        setAnswer(null);
      }}
    />
  );
}

function ConfirmDialog({ onDone }: { onDone: (pass: string | null) => void }) {
  const [sent, setSent] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [state, setState] = useState<CodeState>('idle');
  const [shake, setShake] = useState(false);
  const [wait, setWait] = useState(0);
  const asked = useRef(false);

  const ask = async () => {
    setProblem(null);
    try {
      const reply = await requestStepUp();
      setSent(reply.message);
      setWait(RESEND_SECONDS);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'The code could not be sent. Check your connection.');
    }
  };

  // Once, as it opens (and not twice in development's double render).
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void ask();
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onDone(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const check = async (typed: string) => {
    setState('busy');
    setProblem(null);
    try {
      const pass = await verifyStepUp(typed);
      setState('ok');
      window.setTimeout(() => onDone(pass), 450);
    } catch (error) {
      setState('error');
      setShake(true);
      setCode('');
      setProblem(error instanceof ApiError ? error.message : 'That did not work. Try again.');
    }
  };

  return (
    <div className="dlg-backdrop">
      <div className="dlg tone-info" role="dialog" aria-modal="true" aria-labelledby="cy-title">
        <span className="dlg-icon" aria-hidden="true">
          <Icon name="shield" size={24} />
        </span>
        <h2 id="cy-title">Confirm it is you</h2>
        <div className="dlg-body">
          <p>
            This change moves the shop's money or who can get in, so it needs a fresh code — that way a screen left open
            is not enough.
          </p>
          <p className="cy-sent" role="status">
            <Icon name="mail" size={16} />
            {sent ?? 'Sending a code to your email…'}
          </p>
        </div>

        <div className="cy-boxes">
          <CodeBoxes
            // Mounted again once the code is on its way, so the first box is ready to type into.
            key={sent ? 'ready' : 'waiting'}
            value={code}
            onChange={(next) => {
              setCode(next);
              if (state === 'error') setState('idle');
            }}
            onComplete={(typed) => void check(typed)}
            state={state}
            shake={shake}
            onShakeEnd={() => setShake(false)}
            disabled={!sent || state === 'busy' || state === 'ok'}
            autoFocus
          />
        </div>
        {problem && (
          <p className="cy-problem" role="alert">
            {problem}
          </p>
        )}

        <div className="cy-foot">
          <button type="button" className="cy-again" disabled={wait > 0} onClick={() => void ask()}>
            {wait > 0 ? `New code in ${clock(wait * 1000)}` : 'Send a new code'}
          </button>
        </div>

        <div className="dlg-actions">
          <button type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
