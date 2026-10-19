import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { getNotificationSettings, updateNotificationSettings, type NotificationSettings } from '../api/admin';
import { Icon, type IconName } from '../ui/Icon';
import { Switch } from '../ui/Switch';
import './announcements.css';

const MARK: Record<string, IconName> = {
  ADMIN_TICKETS: 'help',
  ADMIN_QUEUE: 'inbox',
  ADMIN_SYSTEM: 'alert',
  ACCOUNT: 'user',
};

/**
 * What this administrator is sent, and how (§287). The bell has everything;
 * these choose what also comes by email. Platform problems always do.
 */
export function NotificationSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['notification-settings'], queryFn: getNotificationSettings });
  const save = useMutation({
    mutationFn: (choice: { category: string; on: boolean }) =>
      updateNotificationSettings({ choices: [{ category: choice.category as never, channel: 'EMAIL', on: choice.on }] }),
    onMutate: (choice) => {
      const before = queryClient.getQueryData<NotificationSettings>(['notification-settings']);
      if (before) {
        queryClient.setQueryData(['notification-settings'], {
          ...before,
          categories: before.categories.map((c) =>
            c.category === choice.category && c.email ? { ...c, email: { ...c.email, on: choice.on } } : c,
          ),
        });
      }
      return { before };
    },
    onError: (_e, _c, context) => context?.before && queryClient.setQueryData(['notification-settings'], context.before),
    onSuccess: (next) => queryClient.setQueryData(['notification-settings'], next),
  });

  return (
    <section className="an">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Notifications</h1>
            <p className="muted">
              The bell has everything, and updates as it happens. Here you choose what also comes by email — each administrator
              chooses their own.
            </p>
          </div>
        </header>
      </div>
      {save.error && (
        <p className="error an-error" role="alert">
          <Icon name="alert" size={15} />
          {save.error instanceof ApiError ? save.error.message : 'That did not save.'}
        </p>
      )}
      <article className="an-card ans">
        <header className="ans-head">
          <h2>By email</h2>
        </header>
        {settings.isLoading && <div className="skeleton" style={{ height: 220, borderRadius: 18 }} />}
        <ul className="ans-rows">
          {settings.data?.categories.map((c) => (
            <li key={c.category}>
              <span className="ans-mark" aria-hidden="true">
                <Icon name={MARK[c.category] ?? 'bell'} size={17} />
              </span>
              <span className="ans-what">
                <strong>{c.title}</strong>
                <span>{c.hint}</span>
              </span>
              {c.email?.locked ? (
                <span className="ans-lock" title={c.email.locked}>
                  <Icon name="lock" size={13} /> Always
                </span>
              ) : c.email ? (
                <Switch
                  checked={c.email.on}
                  label={`${c.email.on ? 'Stop' : 'Get'} emails about ${c.title.toLowerCase()}`}
                  onChange={(on) => save.mutate({ category: c.category, on })}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
