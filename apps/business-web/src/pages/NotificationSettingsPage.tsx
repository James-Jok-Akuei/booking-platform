import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationCategorySetting,
  type NotificationSettings,
  type NotificationSettingsChange,
} from '../api/business';
import { useAccess } from '../access';
import { pushState, pushSupported, turnOffHere, turnOnHere, type PushState } from '../notify/webPush';
import { Icon, type IconName } from '../ui/Icon';
import { Switch } from '../ui/Switch';
import './notification-settings.css';

/** Each kind's mark, so the list reads at a glance. */
const MARK: Record<string, { icon: IconName; tone: string }> = {
  BOOKINGS: { icon: 'calendar', tone: 'ask' },
  MESSAGES: { icon: 'message', tone: 'accent' },
  REVIEWS: { icon: 'star', tone: 'star' },
  MONEY: { icon: 'wallet', tone: 'ok' },
  ACCOUNT: { icon: 'store', tone: 'night' },
  NEWS: { icon: 'sparkles', tone: 'accent' },
};

const HOURS = Array.from({ length: 48 }, (_, i) => i * 30);
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * What we send you, and how (§287). The list in the app always has
 * everything; these choose what also comes as an alert or an email. Every
 * switch saves the moment it is flipped.
 */
export function NotificationSettingsPage() {
  const queryClient = useQueryClient();
  const access = useAccess();
  const settings = useQuery({ queryKey: ['notification-settings'], queryFn: getNotificationSettings });

  const save = useMutation({
    mutationFn: (change: NotificationSettingsChange) => updateNotificationSettings(change),
    // Flipped at once; the server's answer settles it.
    onMutate: (change) => {
      const before = queryClient.getQueryData<NotificationSettings>(['notification-settings']);
      if (before) queryClient.setQueryData(['notification-settings'], apply(before, change));
      return { before };
    },
    onError: (_e, _c, context) => {
      if (context?.before) queryClient.setQueryData(['notification-settings'], context.before);
    },
    onSuccess: (next) => queryClient.setQueryData(['notification-settings'], next),
  });

  const s = settings.data;
  const rows = (s?.categories ?? []).filter((c) => c.category !== 'MONEY' || access.money);
  const choose = (category: string, channel: 'EMAIL' | 'PUSH', on: boolean) =>
    save.mutate({ choices: [{ category: category as never, channel, on }] });

  return (
    <section className="ns">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Notifications</h1>
            <p className="muted">
              Your bell in the app always has everything. Here you choose what also comes as an alert or an email —
              everyone on your team chooses their own.
            </p>
          </div>
        </header>
      </div>

      {save.error && (
        <p className="error ns-error" role="alert">
          <Icon name="alert" size={15} />
          {save.error instanceof ApiError ? save.error.message : 'That did not save. Check your connection.'}
        </p>
      )}

      <div className="ns-layout">
        <div className="ns-main">
          <article className="ns-card">
            <header className="ns-card-head">
              <h2>What we send you</h2>
              <div className="ns-cols" aria-hidden="true">
                <span>
                  <Icon name="bell" size={14} /> Alert
                </span>
                <span>
                  <Icon name="mail" size={14} /> Email
                </span>
              </div>
            </header>
            {settings.isLoading && <div className="skeleton ns-skeleton" />}
            <ul className="ns-rows">
              {rows.map((row, i) => (
                <CategoryRow
                  key={row.category}
                  row={row}
                  index={i}
                  digest={row.category === 'BOOKINGS' ? (s?.bookingEmailDigest ?? false) : null}
                  newsWording={s?.newsWording ?? ''}
                  onChoose={choose}
                  onDigest={(on) => save.mutate({ bookingEmailDigest: on })}
                />
              ))}
            </ul>
          </article>
        </div>

        <aside className="ns-side">
          <ThisComputer publicKey={s?.webPushKey ?? null} onChanged={() => void settings.refetch()} />

          {s && (
            <article className="ns-card ns-quiet">
              <header className="ns-quiet-head">
                <span className="ns-quiet-moon" aria-hidden="true">
                  <Icon name="clock" size={18} />
                </span>
                <div>
                  <h2>Quiet hours</h2>
                  <p className="muted small">
                    Alerts that can wait — reviews, money, news — arrive after. Bookings and messages still come straight
                    away.
                  </p>
                </div>
                <Switch
                  checked={s.quietHours.on}
                  label={s.quietHours.on ? 'Turn quiet hours off' : 'Turn quiet hours on'}
                  onChange={(on) => save.mutate({ quietHours: { ...s.quietHours, on } })}
                />
              </header>
              <div className={`ns-quiet-times${s.quietHours.on ? '' : ' is-off'}`}>
                <label>
                  <span>From</span>
                  <select
                    value={s.quietHours.from}
                    disabled={!s.quietHours.on}
                    onChange={(e) => save.mutate({ quietHours: { ...s.quietHours, from: Number(e.target.value) } })}
                  >
                    {HOURS.map((m) => (
                      <option key={m} value={m}>
                        {clock(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="ns-quiet-to" aria-hidden="true">
                  →
                </span>
                <label>
                  <span>Until</span>
                  <select
                    value={s.quietHours.to}
                    disabled={!s.quietHours.on}
                    onChange={(e) => save.mutate({ quietHours: { ...s.quietHours, to: Number(e.target.value) } })}
                  >
                    {HOURS.map((m) => (
                      <option key={m} value={m}>
                        {clock(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </article>
          )}

          {s && s.devices.length > 0 && (
            <article className="ns-card ns-devices">
              <h2>Where alerts go</h2>
              <ul>
                {s.devices.map((d) => (
                  <li key={d.id}>
                    <Icon name={d.kind === 'WEB' ? 'globe' : 'phone'} size={16} />
                    <span>
                      <strong>{d.label ?? (d.kind === 'WEB' ? 'A browser' : 'A phone')}</strong>
                      <small>Since {new Date(d.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </aside>
      </div>
    </section>
  );
}

/** A change, applied to what is on screen before the server answers. */
function apply(s: NotificationSettings, change: NotificationSettingsChange): NotificationSettings {
  return {
    ...s,
    categories: s.categories.map((c) => {
      const mine = change.choices?.filter((x) => x.category === c.category) ?? [];
      return mine.reduce(
        (row, x) => ({
          ...row,
          ...(x.channel === 'EMAIL' && row.email ? { email: { ...row.email, on: x.on } } : {}),
          ...(x.channel === 'PUSH' && row.push ? { push: { ...row.push, on: x.on } } : {}),
        }),
        c,
      );
    }),
    quietHours: change.quietHours ?? s.quietHours,
    bookingEmailDigest: change.bookingEmailDigest ?? s.bookingEmailDigest,
  };
}

function CategoryRow({
  row,
  index,
  digest,
  newsWording,
  onChoose,
  onDigest,
}: {
  row: NotificationCategorySetting;
  index: number;
  digest: boolean | null;
  newsWording: string;
  onChoose: (category: string, channel: 'EMAIL' | 'PUSH', on: boolean) => void;
  onDigest: (on: boolean) => void;
}) {
  const mark = MARK[row.category] ?? { icon: 'bell' as IconName, tone: 'night' };
  const channel = (which: 'EMAIL' | 'PUSH') => {
    const c = which === 'EMAIL' ? row.email : row.push;
    if (!c) return <span className="ns-none">—</span>;
    if (c.locked) {
      return (
        <span className="ns-lock" title={c.locked} aria-label={c.locked}>
          <Icon name="lock" size={13} /> <span>Always</span>
        </span>
      );
    }
    return (
      <Switch
        checked={c.on}
        label={`${c.on ? 'Turn off' : 'Turn on'} ${row.title.toLowerCase()} by ${which === 'EMAIL' ? 'email' : 'alert'}`}
        onChange={(on) => onChoose(row.category, which, on)}
      />
    );
  };

  return (
    <li className={`ns-row${row.needsYes ? ' is-news' : ''}`} style={{ animationDelay: `${index * 40}ms` }}>
      <span className={`ns-mark tone-${mark.tone}`} aria-hidden="true">
        <Icon name={mark.icon} size={17} />
      </span>
      <div className="ns-what">
        <strong>{row.title}</strong>
        <span>{row.hint}</span>
        {row.email?.locked && <em>{row.email.locked}</em>}
        {row.needsYes && <em className="ns-consent">Turning these on means: “{newsWording}”</em>}
        {digest !== null && (
          <div className="ns-digest" role="radiogroup" aria-label="Booking emails">
            <button type="button" role="radio" aria-checked={!digest} className={!digest ? 'is-on' : ''} onClick={() => onDigest(false)}>
              Each one
            </button>
            <button type="button" role="radio" aria-checked={digest} className={digest ? 'is-on' : ''} onClick={() => onDigest(true)}>
              One summary at 7:00
            </button>
          </div>
        )}
      </div>
      <div className="ns-switch">{channel('PUSH')}</div>
      <div className="ns-switch">{channel('EMAIL')}</div>
    </li>
  );
}

/** Alerts on this computer: the browser's own notifications (§287). */
function ThisComputer({ publicKey, onChanged }: { publicKey: string | null; onChanged: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const on = async () => {
    if (!publicKey) return;
    setBusy(true);
    setProblem(null);
    try {
      setState(await turnOnHere(publicKey));
      onChanged();
    } catch {
      setProblem('That did not work. Try again, or check this site is allowed to send notifications.');
    } finally {
      setBusy(false);
    }
  };
  const off = async () => {
    setBusy(true);
    await turnOffHere();
    setState(await pushState());
    onChanged();
    setBusy(false);
  };

  const words: Record<PushState, { title: string; line: string }> = {
    on: { title: 'Alerts are on here', line: 'New bookings and messages pop up on this computer, even with the app in another tab.' },
    off: { title: 'Alerts on this computer', line: 'Hear about a new booking the moment it comes in, even with the app in another tab.' },
    blocked: {
      title: 'This browser blocks alerts',
      line: 'Allow notifications for this site — the lock or tune icon beside the address — then come back here.',
    },
    unsupported: {
      title: 'Alerts are not available here',
      line: 'This browser cannot show alerts. Chrome, Edge, Firefox and Safari on a Mac can; on an iPhone, add the app to your home screen first.',
    },
  };
  const now = state ?? 'off';

  return (
    <article className={`ns-card ns-here is-${now}`}>
      <span className="ns-here-ring" aria-hidden="true">
        <Icon name="bell" size={22} />
      </span>
      <h2>{words[now].title}</h2>
      <p className="muted small">{words[now].line}</p>
      {!publicKey && pushSupported() && now !== 'on' ? (
        <p className="ns-here-note">Alerts on computers are not switched on for the platform yet.</p>
      ) : now === 'on' ? (
        <button type="button" className="ns-here-btn is-quiet" disabled={busy} onClick={() => void off()}>
          Turn off on this computer
        </button>
      ) : now === 'off' ? (
        <button type="button" className="primary ns-here-btn" disabled={busy || !publicKey} onClick={() => void on()}>
          <Icon name="bell" size={16} /> {busy ? 'Turning on…' : 'Turn on alerts here'}
        </button>
      ) : null}
      {problem && <p className="ns-here-problem">{problem}</p>}
    </article>
  );
}
