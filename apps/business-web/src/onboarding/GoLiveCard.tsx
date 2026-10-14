import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { getMe, getProfile, getReadiness, submitForReview, type Readiness, type ReadinessKey } from '../api/business';
import { Icon, type IconName } from '../ui/Icon';
import { ITEM_WORDS } from './steps';
import { usePostShop } from './usePostShop';
import './golive.css';
import { accessOf } from '../access';

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
  error instanceof ApiError ? error.message : 'That did not send. Check your connection and try again.';

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
      return <ReadyToPost readiness={r} name={profile.data?.name ?? 'your shop'} canAct={canAct} />;
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
    return <Live name={profile.data?.name ?? 'Your shop'} onClose={close} />;
  }

  const required = r.items.filter((i) => i.required);
  const done = required.filter((i) => i.done).length;
  const missing = required.filter((i) => !i.done);
  const waiting = r.status === 'PENDING' && r.submittedAt !== null;

  if (r.status === 'SUSPENDED') {
    return (
      <section className="gl is-danger" aria-label="Your shop's status">
        <div className="gl-head">
          <span className="gl-badge">
            <Icon name="alert" size={24} />
          </span>
          <div className="gl-text">
            <span className="gl-eyebrow">Hidden from customers</span>
            <h2>Your shop is suspended</h2>
            <p>Customers cannot find it or book. Bookings already made still stand.</p>
            {r.statusReason && <Reason text={r.statusReason} />}
          </div>
          <div className="gl-actions">
            <Link to="/help" className="btn-dark">
              <Icon name="help" size={18} /> Talk to support
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (waiting) {
    const sent = new Date(r.submittedAt!);
    return (
      <section className="gl is-waiting" aria-label="Your shop's status">
        <div className="gl-head">
          <span className="gl-badge gl-pulse">
            <Icon name="hourglass" size={24} />
          </span>
          <div className="gl-text">
            <span className="gl-eyebrow">Sent {sent.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</span>
            <h2>We are checking your shop</h2>
            <p>
              Usually within one working day. We may call your shop’s number, and you get an email at{' '}
              <b>{me.data.email}</b> the moment it is live.
            </p>
          </div>
        </div>
        <Track at={1} />
        <div className="gl-meanwhile">
          <span>While you wait</span>
          <Link to="/profile">
            <Icon name="image" size={16} /> Add photos
          </Link>
          <Link to="/services">
            <Icon name="tag" size={16} /> More services
          </Link>
          <Link to="/people">
            <Icon name="users" size={16} /> Invite your team
          </Link>
        </div>
      </section>
    );
  }

  const rejected = r.status === 'REJECTED';
  return (
    <section className={`gl ${rejected ? 'is-rejected' : 'is-setup'}`} aria-label="Your shop's status">
      <div className="gl-head">
        {rejected ? (
          <span className="gl-badge">
            <Icon name="refresh" size={24} />
          </span>
        ) : (
          <Ring done={done} total={required.length} />
        )}
        <div className="gl-text">
          <span className="gl-eyebrow">{rejected ? 'Needs a change' : 'Not live yet'}</span>
          <h2>{rejected ? 'Make the change, then send your shop back' : missing.length ? 'Finish setting up your shop' : 'Your shop is ready to send'}</h2>
          <p>
            {rejected
              ? 'We could not approve it yet. Everything you set up is still here.'
              : missing.length
                ? `${missing.length} ${missing.length === 1 ? 'thing' : 'things'} left before we can check it and put it live. Customers cannot see it until then.`
                : 'Everything we need is in. Send it and we check it, usually within one working day.'}
          </p>
          {rejected && r.statusReason && <Reason text={r.statusReason} />}
        </div>
        {canAct ? (
          <div className="gl-actions">
            {r.canSubmit ? (
              <button type="button" className="primary gl-go" disabled={submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Sending…' : rejected ? 'Send back for review' : 'Send for review'}
                {!submit.isPending && <Icon name="send" size={16} />}
              </button>
            ) : (
              <Link to="/welcome" className="btn-dark gl-go">
                Continue setting up <Icon name="arrowRight" size={17} stroke={2.4} />
              </Link>
            )}
            {rejected && (
              <Link to="/profile" className="btn-quiet">
                <Icon name="pencil" size={16} /> Edit your shop
              </Link>
            )}
          </div>
        ) : (
          <p className="gl-staff">The owner, or a manager of every branch, finishes this.</p>
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
      {onlyExtras && <li className="gl-list-head">Nice to have — add whenever you like</li>}
      {items.map((item) => {
        const words = ITEM_WORDS[item.key];
        const body = (
          <>
            <span className="gl-tick">{item.done ? <Icon name="check" size={13} stroke={3.2} /> : null}</span>
            <span className="gl-item">
              {words.label}
              {!item.required && <em>optional</em>}
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
    <span className="gl-ring" role="img" aria-label={`${done} of ${total} done`}>
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
    { label: 'Set up your shop', icon: 'store' },
    { label: 'We check it', icon: 'shield' },
    { label: 'You post it', icon: 'send' },
    { label: 'Customers book', icon: 'calendarCheck' },
  ];
  return (
    <ol className="gl-track" aria-label="On the way to going live">
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
      <strong>What we said</strong>
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
  // Lost since approval — a service switched off, the hours cleared.
  const gaps = readiness.goLiveGaps;
  return (
    <section className="gl is-approved" aria-label="Your shop's status">
      <div className="gl-head">
        <span className="gl-badge">
          <Icon name="checkCircle" size={26} />
        </span>
        <div className="gl-text">
          <span className="gl-eyebrow">Approved · not posted yet</span>
          <h2>Your shop is approved. Post it when you are ready</h2>
          <p>
            Customers cannot see <b>{name}</b> yet. Look it over the way they will, then post it — and from that moment they
            can find you and book. No rush: everything you change is saved as you go.
          </p>
        </div>
        {canAct ? (
          <div className="gl-actions">
            <Link to="/profile" className="btn-quiet">
              <Icon name="eye" size={16} /> See it as customers will
            </Link>
            <button
              type="button"
              className="primary gl-go gl-post"
              disabled={post.isPending || !readiness.canPublish}
              onClick={() => void ask()}
            >
              {post.isPending ? 'Posting…' : 'Post my shop'}
              {!post.isPending && <Icon name="send" size={16} />}
            </button>
          </div>
        ) : (
          <p className="gl-staff">The owner, or a manager of every branch, posts it.</p>
        )}
      </div>

      {gaps.length > 0 && (
        <p className="gl-problem" role="status">
          <Icon name="alert" size={16} />
          <span>
            Before it can be posted, it needs {gaps.map((k) => ITEM_WORDS[k].label.toLowerCase()).join(' and ')} —
            otherwise customers would find nothing to book.{' '}
            {FIX_AT[gaps[0]] && <Link to={FIX_AT[gaps[0]]!}>Add it</Link>}
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

/** The moment a shop goes live, once. */
function Live({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <section className="gl is-live" aria-label="Your shop is live">
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
          <span className="gl-eyebrow">Posted</span>
          <h2>You are live! 🎉</h2>
          <p>
            Customers can now find <b>{name}</b> and book. New bookings appear on this page and in Appointments, and we tell
            you each time.
          </p>
        </div>
        <div className="gl-actions">
          <Link to="/services" className="btn-quiet">
            <Icon name="plus" size={16} /> Add more services
          </Link>
          <button type="button" className="gl-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
