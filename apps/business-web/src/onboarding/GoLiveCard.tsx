import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { getMe, getProfile, getReadiness, submitForReview, type Readiness, type ReadinessKey } from '../api/business';
import { Icon, type IconName } from '../ui/Icon';
import { ITEM_WORDS } from './steps';
import { usePostShop } from './usePostShop';
import { useSpotlight } from './useSpotlight';
import './golive.css';
import { accessOf } from '../access';
import { Trans } from '@lingui/react/macro';
import { plural, t } from '@lingui/core/macro';
import { formatDate, listOf } from '../i18n/format';

const DAY = 24 * 60 * 60 * 1000;
const seenKey = (businessId: string) => `bp.live-seen.${businessId}`;

const readSeen = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const said = (error: unknown) =>
  error instanceof ApiError ? error.message : t`That did not send. Check your connection and try again.`;

/**
 * Where the shop stands, at the top of the Overview, until it is live (§256).
 *
 * Every state says what it means and what to do next, in the seller's words
 * rather than the status's: still being set up (a checklist, and the way back
 * into setting up), sent and waiting (what happens now, and what to make
 * better meanwhile), sent back (what we said, and sending it again — §255),
 * suspended (why, and who to talk to), approved and not yet posted (look
 * it over, then post it — §268). A shop posted in the last week is told it is
 * live, once; a live shop otherwise needs no card.
 */
export function GoLiveCard() {
  const queryClient = useQueryClient();
  const readiness = useQuery({ queryKey: ['readiness'], queryFn: getReadiness });
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const businessId = me.data?.businessMembership?.businessProfile.id ?? '';
  // Setting up, sending and posting change the whole shop: the owner, or a
  // manager of every branch (§277).
  const canAct = accessOf(me.data?.businessMembership, me.isSuccess).runsBusiness;
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Sent here from the sidebar to send the shop for review (§306).
  const sendSpot = useSpotlight('send-review');

  const submit = useMutation({
    mutationFn: submitForReview,
    onSuccess: (next) => {
      queryClient.setQueryData(['readiness'], next);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const r = readiness.data;
  if (!r || !me.data) return null;

  if (r.status === 'APPROVED') {
    if (!r.publishedAt) {
      return <ReadyToPost readiness={r} name={profile.data?.name ?? t`your shop`} canAct={canAct} />;
    }
    const changed = r.publishedAt;
    if (Date.now() - new Date(changed).getTime() > 7 * DAY) return null;
    if (dismissed === changed || readSeen(seenKey(businessId)) === changed) return null;
    const close = () => {
      try {
        localStorage.setItem(seenKey(businessId), changed);
      } catch {
        // Private windows: it shows again next time, which is harmless.
      }
      setDismissed(changed);
    };
    return <Live name={profile.data?.name ?? t`Your shop`} onClose={close} />;
  }

  const required = r.items.filter((i) => i.required);
  const done = required.filter((i) => i.done).length;
  const missing = required.filter((i) => !i.done);
  const waiting = r.status === 'PENDING' && r.submittedAt !== null;

  if (r.status === 'SUSPENDED') {
    return (
      <section className="gl is-danger" aria-label={t`Your shop's status`} data-tour="go-live">
        <div className="gl-head">
          <span className="gl-badge">
            <Icon name="alert" size={24} />
          </span>
          <div className="gl-text">
            <span className="gl-eyebrow"><Trans>Hidden from customers</Trans></span>
            <h2><Trans>Your shop is suspended</Trans></h2>
            <p><Trans>Customers cannot find it or book. Bookings already made still stand.</Trans></p>
            {r.statusReason && <Reason text={r.statusReason} />}
          </div>
          <div className="gl-actions">
            <Link to="/help" className="btn-dark">
              <Icon name="help" size={18} />{' '}
              <Trans>Talk to support</Trans>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (waiting) {
    const sent = new Date(r.submittedAt!);
    return (
      <section className="gl is-waiting" aria-label={t`Your shop's status`} data-tour="go-live">
        <div className="gl-head">
          <span className="gl-badge gl-pulse">
            <Icon name="hourglass" size={24} />
          </span>
          <div className="gl-text">
            <span className="gl-eyebrow"><Trans>Sent {formatDate(sent, { day: 'numeric', month: 'long' })}</Trans></span>
            <h2><Trans>We are checking your shop</Trans></h2>
            <p>
              <Trans>
                Usually within one working day. We may call your shop’s number, and you get an email at{' '}
                <b>{me.data.email}</b> the moment it is live.
              </Trans>
            </p>
          </div>
        </div>
        <Track at={1} />
        <div className="gl-meanwhile">
          <span><Trans>While you wait</Trans></span>
          <Link to="/profile">
            <Icon name="image" size={16} />{' '}
            <Trans>Add photos</Trans>
          </Link>
          <Link to="/services">
            <Icon name="tag" size={16} />{' '}
            <Trans>More services</Trans>
          </Link>
          <Link to="/people">
            <Icon name="users" size={16} />{' '}
            <Trans>Invite your team</Trans>
          </Link>
        </div>
      </section>
    );
  }

  const rejected = r.status === 'REJECTED';
  return (
    <section className={`gl ${rejected ? 'is-rejected' : 'is-setup'}${sendSpot.lit ? ' is-spotlit' : ''}`} aria-label={t`Your shop's status`} data-tour="go-live">
      <div className="gl-head">
        {rejected ? (
          <span className="gl-badge">
            <Icon name="refresh" size={24} />
          </span>
        ) : (
          <Ring done={done} total={required.length} />
        )}
        <div className="gl-text">
          <span className="gl-eyebrow">{rejected ? t`Needs a change` : t`Not live yet`}</span>
          <h2>{rejected ? t`Make the change, then send your shop back` : missing.length ? t`Finish setting up your shop` : t`Your shop is ready to send`}</h2>
          <p>
            {rejected
              ? t`We could not approve it yet. Everything you set up is still here.`
              : missing.length
                ? plural(missing.length, { one: '# thing left before we can check it and put it live. Customers cannot see it until then.', other: '# things left before we can check it and put it live. Customers cannot see it until then.' })
                : t`Everything we need is in. Send it and we check it, usually within one working day.`}
          </p>
          {rejected && r.statusReason && <Reason text={r.statusReason} />}
        </div>
        {canAct ? (
          <div className="gl-actions">
            {r.canSubmit ? (
              <span className="gl-spot-wrap">
              <button
                ref={sendSpot.ref}
                type="button"
                className={`primary gl-go gl-send${sendSpot.lit ? ' is-spotlit' : ''}`}
                disabled={submit.isPending}
                onClick={() => {
                  sendSpot.done();
                  submit.mutate();
                }}
              >
                {submit.isPending ? t`Sending…` : rejected ? t`Send back for review` : t`Send for review`}
                {!submit.isPending && <Icon name="send" size={16} />}
              </button>
              {sendSpot.lit && <SpotHint words={rejected ? t`Press here to send it back` : t`Press here to send it for review`} />}
              </span>
            ) : (
              <Link to="/welcome" className="btn-dark gl-go"><Trans>Continue setting up </Trans><Icon name="arrowRight" size={17} stroke={2.4} />
              </Link>
            )}
            {rejected && (
              <Link to="/profile" className="btn-quiet">
                <Icon name="pencil" size={16} />{' '}
                <Trans>Edit your shop</Trans>
              </Link>
            )}
          </div>
        ) : (
          <p className="gl-staff"><Trans>The owner, or a manager of every branch, finishes this.</Trans></p>
        )}
      </div>

      {submit.error && (
        <p className="gl-problem" role="alert">
          <Icon name="alert" size={16} /> {said(submit.error)}
        </p>
      )}

      {(!rejected || missing.length > 0) && <Checklist readiness={r} canAct={canAct} onlyExtras={missing.length === 0} />}
      {!rejected && <Track at={0} />}
    </section>
  );
}

/** What is in and what is not — or, once everything needed is in, only the extras. */
function Checklist({ readiness, canAct, onlyExtras }: { readiness: Readiness; canAct: boolean; onlyExtras: boolean }) {
  const items = onlyExtras ? readiness.items.filter((i) => !i.required) : readiness.items;
  return (
    <ul className={`gl-list${onlyExtras ? ' is-extras' : ''}`}>
      {onlyExtras && <li className="gl-list-head"><Trans>Nice to have — add whenever you like</Trans></li>}
      {items.map((item) => {
        const words = ITEM_WORDS[item.key];
        const body = (
          <>
            <span className="gl-tick">{item.done ? <Icon name="check" size={13} stroke={3.2} /> : null}</span>
            <span className="gl-item">
              {words.label}
              {!item.required && <em><Trans>optional</Trans></em>}
            </span>
            {!item.done && canAct && <Icon name="chevronRight" size={16} />}
          </>
        );
        return (
          <li key={item.key} className={`${item.done ? 'is-done' : ''}${item.required ? '' : ' is-optional'}`}>
            {!item.done && canAct ? <Link to={`/welcome?step=${words.step}`}>{body}</Link> : <span>{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** How much of what is required is in, as a ring. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 26;
  const length = 2 * Math.PI * r;
  const share = total ? done / total : 0;
  return (
    <span className="gl-ring" role="img" aria-label={t`${done} of ${total} done`}>
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="gl-ring-track" />
        <circle cx="32" cy="32" r={r} className="gl-ring-fill" strokeDasharray={length} strokeDashoffset={length * (1 - share)} />
      </svg>
      <b>
        {done}
        <small>/{total}</small>
      </b>
    </span>
  );
}

/** Set up → checked → posted → booked: where the shop is on the way. */
function Track({ at }: { at: 0 | 1 | 2 }) {
  const stops: Array<{ label: string; icon: IconName }> = [
    { label: t`Set up your shop`, icon: 'store' },
    { label: t`We check it`, icon: 'shield' },
    { label: t`You post it`, icon: 'send' },
    { label: t`Customers book`, icon: 'calendarCheck' },
  ];
  return (
    <ol className="gl-track" aria-label={t`On the way to going live`}>
      {stops.map((s, i) => (
        <li key={s.label} className={i < at ? 'is-done' : i === at ? 'is-on' : ''}>
          <span>{i < at ? <Icon name="check" size={14} stroke={3} /> : <Icon name={s.icon} size={15} />}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function Reason({ text }: { text: string }) {
  return (
    <blockquote className="gl-reason">
      <strong><Trans>What we said</Trans></strong>
      {text}
    </blockquote>
  );
}

/** Where to fix what approval needed, once the shop is past setting up (which sends an approved shop home). */
const FIX_AT: Partial<Record<ReadinessKey, string>> = { name: '/profile', branch: '/hours', hours: '/hours', service: '/services' };

/**
 * Approved, and not yet showing (§268): the shop looks itself over and posts
 * itself — customers never meet a shop its owner did not mean to show yet.
 */
function ReadyToPost({ readiness, name, canAct }: { readiness: Readiness; name: string; canAct: boolean }) {
  const { ask, post } = usePostShop(name);
  // Sent here from the sidebar's "Approved — post it" (§306).
  const spot = useSpotlight('post-shop');
  // Lost since approval — a service switched off, the hours cleared.
  const gaps = readiness.goLiveGaps;
  // The language's own "and" (§308): a list, never English glued in.
  const needs = listOf(gaps.map((k) => ITEM_WORDS[k].label.toLowerCase()));
  return (
    <section className={`gl is-approved${spot.lit ? ' is-spotlit' : ''}`} aria-label={t`Your shop's status`} data-tour="go-live">
      <div className="gl-head">
        <span className="gl-badge">
          <Icon name="checkCircle" size={26} />
        </span>
        <div className="gl-text">
          <span className="gl-eyebrow"><Trans>Approved · not posted yet</Trans></span>
          <h2><Trans>Your shop is approved. Post it when you are ready</Trans></h2>
          <p>
            <Trans>
              Customers cannot see <b>{name}</b> yet. Look it over the way they will, then post it — and from that moment they
              can find you and book. No rush: change anything you like first.
            </Trans>
          </p>
        </div>
        {canAct ? (
          <div className="gl-actions">
            <Link to="/profile" className="btn-quiet">
              <Icon name="eye" size={16} />{' '}
              <Trans>See it as customers will</Trans>
            </Link>
            <span className="gl-spot-wrap">
            <button
              ref={spot.ref}
              type="button"
              className={`primary gl-go gl-post${spot.lit ? ' is-spotlit' : ''}`}
              disabled={post.isPending || !readiness.canPublish}
              onClick={() => {
                spot.done();
                void ask();
              }}
            >
              {post.isPending ? t`Posting…` : t`Post my shop`}
              {!post.isPending && <Icon name="send" size={16} />}
            </button>
            {spot.lit && readiness.canPublish && <SpotHint words={t`Press here to post your shop`} />}
            </span>
          </div>
        ) : (
          <p className="gl-staff"><Trans>The owner, or a manager of every branch, posts it.</Trans></p>
        )}
      </div>

      {readiness.approvalAdvice && <AdviceFromUs readiness={readiness} canAct={canAct} />}

      {gaps.length > 0 && (
        <p className="gl-problem" role="status">
          <Icon name="alert" size={16} />
          <span>
            <Trans>
              Before it can be posted, it needs {needs} — otherwise customers would find nothing to book.{' '}
            </Trans>
            {FIX_AT[gaps[0]] && <Link to={FIX_AT[gaps[0]]!}><Trans>Add it</Trans></Link>}
          </span>
        </p>
      )}
      {post.error && (
        <p className="gl-problem" role="alert">
          <Icon name="alert" size={16} /> {said(post.error)}
        </p>
      )}

      <Track at={2} />
    </section>
  );
}

type AdviceKey = Readiness['advice'][number]['key'];

/** Where each piece of advice is added, and its mark (the same as "Make your shop stand out"). */
const ADVICE_AT: Record<AdviceKey, { to: string; icon: IconName }> = {
  cover: { to: '/profile', icon: 'image' },
  logo: { to: '/profile', icon: 'store' },
  about: { to: '/profile', icon: 'pencil' },
  type: { to: '/profile', icon: 'tag' },
  phone: { to: '/profile', icon: 'phone' },
  gallery: { to: '/profile', icon: 'camera' },
  hours: { to: '/hours', icon: 'clock' },
  where: { to: '/hours', icon: 'pin' },
  'service-photos': { to: '/services', icon: 'image' },
  'service-words': { to: '/services', icon: 'pencil' },
  payout: { to: '/getting-paid', icon: 'wallet' },
};

/**
 * What our review team advised when it approved the shop (§303): their note,
 * and the things they asked for, each ticked off by itself as it is added —
 * read live from the shop, not from what was true on the day.
 */
function AdviceFromUs({ readiness, canAct }: { readiness: Readiness; canAct: boolean }) {
  const sent = readiness.approvalAdvice!;
  const now = new Map(readiness.advice.map((item) => [item.key, item]));
  const items = sent.keys.map((key) => now.get(key)).filter((item): item is Readiness['advice'][number] => Boolean(item));
  const done = items.filter((item) => item.done).length;
  const allDone = items.length > 0 && done === items.length;
  return (
    <div className={`gl-advice${allDone ? ' is-done' : ''}`}>
      <div className="gl-advice-head">
        <span className="gl-advice-mark">
          <Icon name={allDone ? 'checkCircle' : 'bulb'} size={18} />
        </span>
        <div>
          <strong>{allDone ? t`All done — thank you` : t`Our advice before you post`}</strong>
          <span>
            {items.length === 0
              ? t`From our review team`
              : allDone
                ? t`Everything we suggested is in. Shops like yours get booked far more often.`
                : t`Shops with clear, high-resolution photos and full details get booked far more often · ${done} of ${items.length} done`}
          </span>
        </div>
      </div>
      {sent.note && (
        <blockquote className="gl-advice-note">
          “{sent.note}”<cite><Trans>— Our review team</Trans></cite>
        </blockquote>
      )}
      {items.length > 0 && (
        <ul className="gl-advice-list">
          {items.map((item) => {
            const at = ADVICE_AT[item.key];
            const go = !item.done && canAct;
            const row = (
              <>
                <span className="gl-advice-icon">
                  <Icon name={item.done ? 'check' : at.icon} size={15} stroke={item.done ? 3 : 2} />
                </span>
                <span className="gl-advice-words">
                  <strong>{item.title}</strong>
                  <em>{item.done ? t`Done` : `${item.why.charAt(0).toUpperCase()}${item.why.slice(1)}`}</em>
                </span>
                {go && (
                  <span className="gl-advice-go">
                    <span className="gl-advice-go-word"><Trans>Add</Trans></span>
                    <Icon name="arrowRight" size={14} />
                  </span>
                )}
              </>
            );
            // The whole row goes there: on a phone the button is only its arrow.
            return (
              <li key={item.key} className={item.done ? 'is-done' : ''}>
                {go ? (
                  <Link to={at.to} className="gl-advice-row" aria-label={t`Add ${item.title.toLowerCase()}`}>
                    {row}
                  </Link>
                ) : (
                  <div className="gl-advice-row">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Above the button the seller was sent to (§306): what to press, pointing at it. */
function SpotHint({ words }: { words: string }) {
  return (
    <span className="gl-spot" role="status">
      {words}
      <Icon name="chevronDown" size={16} stroke={2.6} />
    </span>
  );
}

/** The moment a shop goes live, once. */
function Live({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <section className="gl is-live" aria-label={t`Your shop is live`}>
      <span className="gl-confetti" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ ['--i' as string]: i }} />
        ))}
      </span>
      <div className="gl-head">
        <span className="gl-badge">
          <Icon name="sparkles" size={26} />
        </span>
        <div className="gl-text">
          <span className="gl-eyebrow"><Trans>Posted</Trans></span>
          <h2><Trans>You are live! 🎉</Trans></h2>
          <p>
            <Trans>
              Customers can now find <b>{name}</b> and book. New bookings appear on this page and in Appointments, and we tell
              you each time.
            </Trans>
          </p>
        </div>
        <div className="gl-actions">
          <Link to="/services" className="btn-quiet">
            <Icon name="plus" size={16} />{' '}
            <Trans>Add more services</Trans>
          </Link>
          <button type="button" className="gl-close" onClick={onClose} aria-label={t`Close`}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
