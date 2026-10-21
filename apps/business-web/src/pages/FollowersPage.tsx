import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { getProfile, listLocations, listShopMessages, sendShopMessage, type ShopMessage } from '../api/business';
import { useAccess } from '../access';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ShopLogo } from '../ui/ShopLogo';
import './followers.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../i18n/format';
import { plural } from '@lingui/core/macro';

const TITLE_MAX = 60;
const BODY_MAX = 300;
const IDEAS = [
  {
    get title() { return t`Free this afternoon`; },
    get body() { return t`Two chairs free after 2 pm today. Book in the app and come straight in.`; },
  },
  {
    get title() { return t`15% off this week`; },
    get body() { return t`Every service until Sunday. Book in the app — the discount is already applied.`; },
  },
  {
    get title() { return t`Something new`; },
    get body() { return t`We just added a new service. Have a look on our page in the app.`; },
  },
];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Your followers (§287, §288): the customers who follow the shop see what is
 * new there in the app — a message sits on the shop's card under their Saved →
 * Following — and those who also said yes to its offers get it as an alert or
 * email. The way Booksy and Fresha let a business reach its own clients, but
 * only those who asked, and once a week so following stays worth it. What
 * they get is exactly the alert in the phone beside the form.
 */
export function FollowersPage() {
  const access = useAccess();
  const queryClient = useQueryClient();
  const messages = useQuery({ queryKey: ['shop-messages'], queryFn: listShopMessages });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [branch, setBranch] = useState<string>('');
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      sendShopMessage({ title: title.trim(), body: body.trim(), ...(branch ? { locationId: branch } : {}) }),
    onSuccess: (next) => {
      queryClient.setQueryData(['shop-messages'], next);
      setTitle('');
      setBody('');
      setSent(true);
    },
  });
  useEffect(() => {
    if (!sent) return;
    const t = window.setTimeout(() => setSent(false), 4000);
    return () => window.clearTimeout(t);
  }, [sent]);

  const data = messages.data;
  const followers = data?.followers ?? 0;
  const withOffers = data?.withOffers ?? 0;
  const shopName = profile.data?.name ?? t`Your shop`;
  const branches = (locations.data ?? []).filter((l) => l.isActive);
  const live = profile.data ? profile.data.status === 'APPROVED' && Boolean(profile.data.publishedAt) && !profile.data.pausedAt : true;
  const waitUntil = data?.nextAt ?? null;
  const ready = title.trim().length >= 3 && body.trim().length >= 3;
  const blocked = !live
    ? t`Your shop needs to be live on the app first.`
    : followers === 0
      ? t`Nobody follows your shop yet.`
      : waitUntil
        ? t`Your next message can go on ${day(waitUntil)}.`
        : null;

  const askSend = async () => {
    if (
      await confirmDialog({
        title: plural(followers, { one: 'Send to # follower?', other: 'Send to # followers?' }),
        body: (
          <p>
            <Trans>All of them see it on your shop in the app.</Trans>{' '}
            {withOffers === 0
              ? t`Nobody has said yes to your offers as alerts yet, so it goes without a notification.`
              : withOffers === 1
                ? t`One of them said yes to your offers, so that person also gets it as an alert or email.`
                : t`${withOffers} of them said yes to your offers, so they also get it as an alert or email.`}{' '}
            <Trans>You can send one message a week, so make it count.</Trans>
          </p>
        ),
        icon: 'megaphone',
        tone: 'accent',
        confirmLabel: t`Send it`,
      })
    ) {
      send.mutate();
    }
  };

  return (
    <section className="fl">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>Followers</Trans></h1>
            <p className="muted">
              <Trans>
                Customers who follow your shop see your new services, discounts and messages in the app. Those who also
                said yes to your offers get your message as an alert. They chose to — and can stop with one tap — so one
                good message a week keeps them following.
              </Trans>
            </p>
          </div>
        </header>
      </div>

      <div className="fl-main">
          <article className="fl-count">
            <span className="fl-count-ring" aria-hidden="true">
              <Icon name="users" size={24} />
            </span>
            <div>
              <strong>{messages.isLoading ? '—' : followers.toLocaleString()}</strong>
              <span>{followers === 1 ? t`person follows` : t`people follow`} {shopName}</span>
              {!messages.isLoading && followers > 0 && (
                <span className="fl-count-offers">
                  <Icon name="bell" size={13} /> {withOffers.toLocaleString()} {withOffers === 1 ? t`gets` : t`get`}
                    <Trans>
                      your
                      offers as alerts
                    </Trans>
                  </span>
              )}
            </div>
            <p className="muted small">
              <Trans>
                Customers follow from your page in the app, and after they book. The more good stories and offers you post,
                the more follow.
              </Trans>
            </p>
          </article>

          <div className="fl-compose-row">
          {access.runsBusiness ? (
            <article className="fl-card fl-compose">
              <h2><Trans>Write to your followers</Trans></h2>
              <label className="fl-field">
                <span><Trans>Title <em>{title.length}/{TITLE_MAX}</em></Trans>
                </span>
                <input
                  value={title}
                  maxLength={TITLE_MAX}
                  placeholder={t`15% off this week`}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="fl-field">
                <span><Trans>Message <em>{body.length}/{BODY_MAX}</em></Trans>
                </span>
                <textarea
                  rows={3}
                  value={body}
                  maxLength={BODY_MAX}
                  placeholder={t`Every service until Sunday. Book in the app — the discount is already applied.`}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              {branches.length > 1 && (
                <label className="fl-field">
                  <span><Trans>Tapping it opens</Trans></span>
                  <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                    <option value="">{t`Your shop’s page`}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="fl-ideas">
                <span>
                  <Icon name="sparkles" size={14} />{' '}
                  <Trans>Start from an idea</Trans>
                </span>
                <div>
                  {IDEAS.map((idea) => (
                    <button
                      key={idea.title}
                      type="button"
                      onClick={() => {
                        setTitle(idea.title);
                        setBody(idea.body);
                      }}
                    >
                      {idea.title}
                    </button>
                  ))}
                </div>
              </div>
              {send.error && (
                <p className="fl-problem" role="alert">
                  <Icon name="alert" size={15} />
                  {send.error instanceof ApiError ? send.error.message : t`That did not send. Check your connection.`}
                </p>
              )}
              {sent && (
                <p className="fl-done" role="status">
                  <Icon name="checkCircle" size={16} />{' '}
                  <Trans>Sent — your followers will see it.</Trans>
                </p>
              )}
              {blocked ? (
                <p className="fl-wait">
                  <Icon name="clock" size={15} /> {blocked}
                </p>
              ) : null}
              <button
                type="button"
                className="primary fl-send"
                disabled={!ready || Boolean(blocked) || send.isPending}
                onClick={() => void askSend()}
              >
                <Icon name="megaphone" size={17} />
                {send.isPending ? t`Sending…` : t`Send to ${followers} ${followers === 1 ? 'follower' : 'followers'}`}
              </button>
            </article>
          ) : (
            <article className="fl-card fl-readonly">
              <Icon name="shield" size={18} />
              <p><Trans>The owner or a manager of every branch writes to followers. You can see what was sent.</Trans></p>
            </article>
          )}
            <LockScreen
              shopName={shopName}
              logoUrl={profile.data?.logoUrl ?? null}
              title={title.trim() || t`Your title`}
              body={body.trim() || t`Your message, as your followers will see it.`}
            />
          </div>

          <article className="fl-card">
            <header className="fl-card-head">
              <h2><Trans>Sent</Trans></h2>
              <span>{data?.messages.length ?? 0}</span>
            </header>
            {data && data.messages.length === 0 && (
              <div className="fl-empty">
                <Icon name="megaphone" size={24} />
                <p><Trans>Nothing sent yet. Your first message shows here, with how many opened it.</Trans></p>
              </div>
            )}
            <ul className="fl-history">
              {data?.messages.map((m, i) => <Sent key={m.id} message={m} index={i} />)}
            </ul>
          </article>
      </div>
    </section>
  );
}

function Sent({ message, index }: { message: ShopMessage; index: number }) {
  const share = message.recipients > 0 ? Math.round((message.read / message.recipients) * 100) : 0;
  return (
    <li style={{ animationDelay: `${index * 45}ms` }}>
      <div className="fl-sent-head">
        <strong>{message.title}</strong>
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleDateString(dateLocale(), { dateStyle: 'medium' })}</time>
      </div>
      <p>{message.body}</p>
      <div className="fl-reach">
        <span><Trans>Alerted <b>{message.recipients}</b> · opened by <b>{message.read}</b></Trans>
        </span>
        <i aria-hidden="true">
          <b style={{ width: `${share}%` }} />
        </i>
      </div>
    </li>
  );
}

/** What a follower's phone shows: the lock screen, with the alert on it. */
function LockScreen({ shopName, logoUrl, title, body }: { shopName: string; logoUrl: string | null; title: string; body: string }) {
  const now = new Date();
  return (
    <div className="fl-phone" aria-label={t`How it looks on a follower's phone`}>
      <div className="fl-phone-time">
        <span>{now.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <strong>{now.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}</strong>
      </div>
      <div className="fl-alert">
        <div className="fl-alert-app">
          <ShopLogo logoUrl={logoUrl} name={shopName} size={22} />
          <span><Trans>BOOKING</Trans></span>
          <small><Trans>now</Trans></small>
        </div>
        <strong>
          {shopName}: {title}
        </strong>
        <p>{body}</p>
      </div>
      <div className="fl-phone-hint">
        <Icon name="bell" size={13} />{' '}
        <Trans>Arrives the way each follower chose — quiet hours kept</Trans>
      </div>
    </div>
  );
}
