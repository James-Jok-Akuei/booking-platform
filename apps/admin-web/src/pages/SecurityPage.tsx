import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, endOtherSessions, endSignIn, getTwoStep, listSessions, newRecoveryCodes, type SignInSession } from '../api/client';
import { TwoStepFlow } from '../session/TwoStepSetup';
import { ago, shortDay } from '../lib/time';
import { alertDialog, confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import './security.css';

/** "an unknown device" → "An unknown device", for the start of a line. */
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** An address worth showing: not this computer's own. */
const shownIp = (ip: string | null) => (ip && !/^(::1|127\.|::ffff:127\.)/.test(ip) ? ip : null);

/** A mark for the kind of device. */
const markOf = (device: string): IconName => (/iPhone|iPad|Android|the app/.test(device) ? 'phone' : 'globe');

/**
 * Your own sign-in (§298): two-step sign-in — on since when, recovery codes
 * left, moving it to a new phone — and where you are signed in, each place
 * signed out with one click.
 */
export function SecurityPage() {
  const queryClient = useQueryClient();
  const twoStep = useQuery({ queryKey: ['two-step'], queryFn: getTwoStep });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const [moving, setMoving] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['two-step'] });
  };
  const end = useMutation({ mutationFn: endSignIn, onSuccess: refresh });
  const others = useMutation({ mutationFn: endOtherSessions, onSuccess: refresh });
  const codes = useMutation({
    mutationFn: newRecoveryCodes,
    onSuccess: (result) => {
      refresh();
      void alertDialog({
        tone: 'ok',
        title: 'New recovery codes',
        body: (
          <>
            <p>The old ones no longer work. Keep these somewhere safe — they are shown only now.</p>
            <ol className="sec-codes">
              {result.recoveryCodes.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ol>
          </>
        ),
        confirmLabel: 'I have saved them',
      });
    },
  });

  const t = twoStep.data;
  const list = sessions.data ?? [];
  const error = end.error ?? others.error ?? codes.error;

  const askEnd = async (s: SignInSession) => {
    const ok = await confirmDialog({
      title: `Sign out on ${s.device}?`,
      body: <p>It will need the email code{t?.enabled ? ' and the app’s code' : ''} to sign in again.</p>,
      tone: 'warn',
      icon: 'logout',
      confirmLabel: 'Sign out there',
      cancelLabel: 'Keep it',
    });
    if (ok) end.mutate(s.id);
  };

  return (
    <section className="sec">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Security</h1>
            <p className="muted">Your own sign-in: the second step from your phone, and every place you are signed in.</p>
          </div>
        </header>
      </div>

      {error && (
        <p className="error" role="alert">
          {error instanceof ApiError ? error.message : 'That did not work.'}
        </p>
      )}

      <div className="sec-grid">
        <article className="card sec-card">
          <h2>
            <Icon name="shield" size={18} /> Two-step sign-in
          </h2>
          {!t ? (
            <div className="skeleton sec-skel" />
          ) : t.enabled ? (
            <>
              <p className="sec-state is-on">
                <Icon name="checkCircle" size={18} />
                <span>
                  <strong>On</strong> since {shortDay(t.enabledAt!)}. Each sign-in asks for the code from your authenticator app.
                </span>
              </p>
              <dl className="sec-facts">
                <div>
                  <dt>Recovery codes left</dt>
                  <dd className={t.recoveryCodesLeft <= 2 ? 'is-low' : ''}>{t.recoveryCodesLeft} of 10</dd>
                </div>
                <div>
                  <dt>This sign-in</dt>
                  <dd>{t.thisSignIn ? 'Made with the code' : 'From before it was on'}</dd>
                </div>
              </dl>
              <div className="sec-actions">
                <button type="button" onClick={() => setMoving(true)}>
                  <Icon name="phone" size={16} /> Move to a new phone
                </button>
                <button
                  type="button"
                  disabled={codes.isPending}
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Make new recovery codes?',
                      body: <p>The ones you have now stop working at once.</p>,
                      tone: 'warn',
                      icon: 'key',
                      confirmLabel: 'Make new ones',
                    });
                    if (ok) codes.mutate();
                  }}
                >
                  <Icon name="key" size={16} /> New recovery codes
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="sec-state is-off">
                <Icon name="alert" size={18} />
                <span>
                  <strong>Off.</strong> {t.required ? 'Every administrator needs it.' : 'Strongly advised for every administrator.'}
                </span>
              </p>
              <div className="sec-actions">
                <button type="button" className="primary" onClick={() => setMoving(true)}>
                  <Icon name="shield" size={16} /> Set it up
                </button>
              </div>
            </>
          )}
        </article>

        <article className="card sec-card">
          <h2>
            <Icon name="globe" size={18} /> Where you are signed in
          </h2>
          {sessions.isLoading ? (
            <div className="skeleton sec-skel" />
          ) : (
            <ul className="sec-sessions">
              {list.map((s) => (
                <li key={s.id} className={s.current ? 'is-current' : ''}>
                  <span className="sec-device">
                    <Icon name={markOf(s.device)} size={18} />
                  </span>
                  <div>
                    <strong>
                      {capital(s.device)}
                      {s.current && <span className="pill verified">This one</span>}
                    </strong>
                    <span>
                      {s.current ? 'Now' : `Last used ${ago(s.lastUsedAt)}`} · signed in {shortDay(s.createdAt)}
                      {shownIp(s.ip) ? ` · ${shownIp(s.ip)}` : ''}
                      {s.twoStep ? ' · with the app’s code' : ''}
                    </span>
                  </div>
                  {!s.current && (
                    <button type="button" disabled={end.isPending} onClick={() => void askEnd(s)}>
                      Sign out
                    </button>
                  )}
                </li>
              ))}
              {list.length === 0 && <li className="sec-empty">Only here.</li>}
            </ul>
          )}
          {list.filter((s) => !s.current).length > 0 && (
            <div className="sec-actions">
              <button type="button" className="danger" disabled={others.isPending} onClick={() => others.mutate()}>
                <Icon name="logout" size={16} /> Sign out everywhere else
              </button>
            </div>
          )}
          <p className="sec-note">Not you? Sign it out, then tell the primary administrator.</p>
        </article>
      </div>

      {moving && (
        <Panel eyebrow="Security" title={t?.enabled ? 'Move to a new phone' : 'Two-step sign-in'} onClose={() => setMoving(false)} width={560}>
          <TwoStepFlow
            moving={t?.enabled}
            leaveLabel="Not now"
            onLeave={() => setMoving(false)}
            onDone={() => {
              setMoving(false);
              refresh();
            }}
          />
        </Panel>
      )}
    </section>
  );
}
