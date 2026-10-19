import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, endOtherSessions, endSignIn, listSessions, type SignInSession } from '../api/client';
import { ago, shortDay } from '../lib/time';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import './security.css';

/** "an unknown device" → "An unknown device", for the start of a line. */
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** An address worth showing: not this computer's own. */
const shownIp = (ip: string | null) => (ip && !/^(::1|127\.|::ffff:127\.)/.test(ip) ? ip : null);
const markOf = (device: string): IconName => (/iPhone|iPad|Android|the app/.test(device) ? 'phone' : 'globe');

/**
 * Where you are signed in (§298): every phone and browser with your account
 * open, this one marked — a phone left at the shop, a computer someone else
 * uses — each signed out with one click. When a sign-in happens somewhere new,
 * you are told, and the notice opens here.
 */
export function SecurityPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  const end = useMutation({ mutationFn: endSignIn, onSuccess: refresh });
  const others = useMutation({ mutationFn: endOtherSessions, onSuccess: refresh });
  const list = sessions.data ?? [];
  const error = end.error ?? others.error;

  const askEnd = async (s: SignInSession) => {
    const ok = await confirmDialog({
      title: `Sign out on ${s.device}?`,
      body: <p>Whoever is using it will need a new code, sent to your email, to get back in.</p>,
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
            <h1>Sign-in and security</h1>
            <p className="muted">Every phone and computer where your account is open. Sign out any you do not recognise.</p>
          </div>
        </header>
      </div>

      {error && (
        <p className="error" role="alert">
          {error instanceof ApiError ? error.message : 'That did not work.'}
        </p>
      )}

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
                    {s.current && <span className="sec-here">This one</span>}
                  </strong>
                  <span>
                    {s.current ? 'Now' : `Last used ${ago(s.lastUsedAt)}`} · signed in {shortDay(s.createdAt)}
                    {shownIp(s.ip) ? ` · ${shownIp(s.ip)}` : ''}
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
        {list.some((s) => !s.current) && (
          <div className="sec-actions">
            <button type="button" className="danger" disabled={others.isPending} onClick={() => others.mutate()}>
              <Icon name="logout" size={16} /> Sign out everywhere else
            </button>
          </div>
        )}
        <div className="sec-tips">
          <p>
            <Icon name="mail" size={15} /> A new phone or browser? We email you, and tell your other phones, each time one signs in.
          </p>
          <p>
            <Icon name="shield" size={15} /> Not you? Sign it out here, then write to us from Help — we can look at it with you.
          </p>
        </div>
      </article>
    </section>
  );
}
