import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_KEY, currentSession, keepAlive } from '../api/client';
import { useAuth } from '../auth/auth-context';
import { Icon } from '../ui/Icon';
import { clock, lengthWords } from './words';
import './session.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/** Activity is written down at most this often — every tab reads it. */
const NOTE_EVERY = 5_000;
/** How long before the end of a sign-in it is said. */
const END_WARNING = 2 * 60_000;
/** How long before an idle sign-out the question is asked: longer for the long day of the seller app. */
const idleWarning = (idleMs: number) => (idleMs >= 60 * 60_000 ? 5 * 60_000 : 2 * 60_000);
/** What counts as someone being here. Background checks for new bookings do not. */
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'] as const;

type Warning = { kind: 'idle' | 'end'; left: number; total: number };

/**
 * Signing out a screen nobody is using (§279).
 *
 * The server ends a sign-in left unused, but this app checks for new bookings
 * and messages every minute, and those checks would keep a forgotten tab
 * signed in for ever. So the screen keeps its own clock, from real clicks,
 * keys and scrolling — shared by every tab of the app, so one busy tab keeps
 * the others open — and asks "Still there?" a little before the end. A sign-in
 * also has a most it may last; that is said two minutes before it comes.
 *
 * While the person is busy without asking the server for anything — reading,
 * scrolling — the sign-in is renewed in the background, so the server's clock
 * agrees with this one.
 */
export function IdleGuard() {
  const { signOut } = useAuth();
  const [warning, setWarning] = useState<Warning | null>(null);
  // Read by the listeners, which outlive renders.
  const asking = useRef(false);
  const endSeen = useRef(false);
  const leaving = useRef(false);
  const lastNote = useRef(0);

  const leave = useCallback(
    (why: 'idle' | 'ended') => {
      if (leaving.current) return;
      leaving.current = true;
      void signOut(why);
    },
    [signOut],
  );

  const note = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastNote.current < NOTE_EVERY) return;
    lastNote.current = now;
    localStorage.setItem(ACTIVE_KEY, String(now));
    const session = currentSession();
    if (session && now - session.renewedAt > (session.idleMinutes * 60_000) / 2) void keepAlive();
  }, []);

  useEffect(() => {
    // A tab — or a browser — opened again after too long is over at once,
    // before anything on it is shown as if it were still open.
    const session = currentSession();
    const last = Number(localStorage.getItem(ACTIVE_KEY) ?? 0);
    if (session && last && Date.now() - last >= session.idleMinutes * 60_000) {
      leave('idle');
      return;
    }
    note(true);

    const onActivity = () => {
      if (!asking.current) note();
    };
    for (const name of ACTIVITY) window.addEventListener(name, onActivity, { passive: true, capture: true });

    const tick = () => {
      const s = currentSession();
      if (!s) return;
      const now = Date.now();
      const idleMs = s.idleMinutes * 60_000;
      const idleLeft = idleMs - (now - Number(localStorage.getItem(ACTIVE_KEY) ?? now));
      const endLeft = s.endsAt ? Date.parse(s.endsAt) - now : Infinity;
      if (endLeft <= 0) return leave('ended');
      if (idleLeft <= 0) return leave('idle');

      const next: Warning | null =
        endLeft <= END_WARNING && !endSeen.current
          ? { kind: 'end', left: endLeft, total: END_WARNING }
          : idleLeft <= idleWarning(idleMs)
            ? { kind: 'idle', left: idleLeft, total: idleWarning(idleMs) }
            : null;
      asking.current = next?.kind === 'idle';
      setWarning(next);
    };
    tick();
    // Timestamps, not counted ticks: a background tab's timer is slowed, and
    // a computer asleep does not tick at all.
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);

    return () => {
      for (const name of ACTIVITY) window.removeEventListener(name, onActivity, { capture: true });
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [leave, note]);

  if (!warning) return null;

  const session = currentSession();
  const idle = lengthWords(session?.idleMinutes ?? 30);
  const most = session?.maxMinutes ? lengthWords(session.maxMinutes) : null;
  const share = Math.max(0, Math.min(1, warning.left / warning.total));
  const r = 30;
  const round = 2 * Math.PI * r;

  const stay = () => {
    asking.current = false;
    note(true);
    setWarning(null);
  };
  const acknowledge = () => {
    endSeen.current = true;
    setWarning(null);
  };

  // Named, so a translator sees the sentence whole (§308).
  const lasts = most ?? t`a set time`;
  return (
    <div className="dlg-backdrop">
      <div
        className="dlg tone-warn idle"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-body"
      >
        <div className="idle-ring" aria-hidden="true">
          <svg className="idle-ring-dial" viewBox="0 0 72 72" width="72" height="72">
            <circle cx="36" cy="36" r={r} className="idle-ring-track" />
            <circle
              cx="36"
              cy="36"
              r={r}
              className="idle-ring-fill"
              strokeDasharray={round}
              strokeDashoffset={round * (1 - share)}
            />
          </svg>
          <Icon name={warning.kind === 'idle' ? 'timer' : 'lock'} size={22} />
        </div>

        <h2 id="idle-title">{warning.kind === 'idle' ? t`Still there?` : t`Time to sign in again`}</h2>
        <div className="dlg-body" id="idle-body">
          {warning.kind === 'idle' ? (
            <p>
              <Trans>
                Nothing has happened here for a while. To keep the account safe, you will be signed out in{' '}
                <b className="idle-time">{clock(warning.left)}</b>.
              </Trans>
            </p>
          ) : (
            <p>
              <Trans>
                For your safety, a sign-in lasts {lasts}. You will be signed out in{' '}
                <b className="idle-time">{clock(warning.left)}</b> — finish what you are doing, then sign in again with a
                new code.
              </Trans>
            </p>
          )}
          <p className="idle-small">
            {warning.kind === 'idle'
              ? t`Unused for ${idle}, a sign-in ends by itself.`
              : t`Signing in again takes a code from your email.`}
          </p>
        </div>

        <div className="dlg-actions">
          <button type="button" onClick={() => void signOut()}>
            <Icon name="logout" size={16} />{' '}
            <Trans>Sign out now</Trans>
          </button>
          {warning.kind === 'idle' ? (
            <button type="button" className="dlg-confirm tone-accent" autoFocus onClick={stay}>
              <Trans>Stay signed in</Trans>
            </button>
          ) : (
            <button type="button" className="dlg-confirm tone-accent" autoFocus onClick={acknowledge}>
              <Trans>OK</Trans>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
