import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  completeAppointment,
  getBalance,
  getMe,
  getProfile,
  listLocationReviews,
  listLocations,
  type Appointment,
  type AppointmentStatus,
  type Balance,
  type Review,
} from '../api/business';
import { listThreads, type Thread } from '../api/chat';
import { useCheckIn } from '../checkin/CheckIn';
import { useMoney } from '../money';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { Stars } from '../ui/Stars';
import {
  addDays,
  ago,
  clock,
  greeting,
  minutesBetween,
  relativeDay,
  sameDay,
  shortDay,
  span,
  startOfDay,
  useNow,
} from '../lib/time';
import { bookingsBetween, REAL_STATUSES } from '../lib/bookings';
import { ForYouTop } from '../ads/ForYouTop';
import { useMediaQuery } from '../shell/useMediaQuery';
import '../ads/ads.css';
import './overview.css';

/**
 * Today (§192) — the page a seller opens the app on.
 *
 * Built in the order the day is worked: who is still coming and who is in the
 * chair (the four numbers at the top), today's schedule with a button on each
 * customer for the next thing to do, the one customer to get ready for next,
 * then the slower questions — how the last two weeks went, when the shop is
 * busiest, money, messages and reviews. Every figure is the server's or is
 * counted from the server's list of bookings; nothing here is decoration.
 */

const REAL = REAL_STATUSES;

const STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  BOOKED: { label: 'Expected', cls: 'booked' },
  IN_PROGRESS: { label: 'In progress', cls: 'in-progress' },
  COMPLETED: { label: 'Done', cls: 'completed' },
  NO_SHOW: { label: 'No-show', cls: 'no-show' },
  CANCELLED: { label: 'Cancelled', cls: 'cancelled' },
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'pending-payment' },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up to its value when it first appears. */
function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(() => (reduceMotion() ? target : 0));
  useEffect(() => {
    if (reduceMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const from = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

export function OverviewPage() {
  const now = useNow(30_000);
  const wide = useMediaQuery('(min-width: 1280px)');
  const queryClient = useQueryClient();
  const money = useMoney();
  const openCheckIn = useCheckIn();

  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const businessId = me.data?.businessMembership?.businessProfile.id;
  const businessName =
    profile.data?.name ?? me.data?.businessMembership?.businessProfile.name ?? 'there';

  // Four weeks back (for the patterns) to a week ahead (for the chart).
  const today = startOfDay(now);
  const from = addDays(today, -27);
  const to = addDays(today, 8);
  const bookings = useQuery({
    queryKey: ['appointments', 'overview', from.toISOString()],
    queryFn: () => bookingsBetween(from, to),
    refetchInterval: 60_000,
  });

  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const balance = useQuery({
    queryKey: ['balance', businessId],
    queryFn: () => getBalance(businessId!),
    enabled: Boolean(businessId),
    retry: false,
  });
  const threads = useQuery({
    queryKey: ['threads', 'badge'],
    queryFn: () => listThreads({ limit: 100 }),
    refetchInterval: 60_000,
  });
  const branchIds = (locations.data ?? []).filter((l) => l.isActive).map((l) => l.id);
  const reviews = useQuery({
    queryKey: ['overview-reviews', branchIds.join(',')],
    queryFn: async () => {
      const pages = await Promise.all(branchIds.map((id) => listLocationReviews(id, 4)));
      const names = new Map((locations.data ?? []).map((l) => [l.id, l.name]));
      return pages
        .flatMap((page) => page.reviews.map((review) => ({ review, branch: names.get(page.locationId) ?? '' })))
        .sort((a, b) => b.review.createdAt.localeCompare(a.review.createdAt))
        .slice(0, 3);
    },
    enabled: branchIds.length > 0,
  });

  const complete = useMutation({
    mutationFn: (id: string) => completeAppointment(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] }),
  });

  // ---- what the numbers are made of ----
  const all = bookings.data ?? [];
  const at = (a: Appointment) => new Date(a.startTime);
  const todays = all.filter((a) => sameDay(at(a), now)).sort((x, y) => at(x).getTime() - at(y).getTime());
  const expectedToday = todays.filter((a) => a.status === 'BOOKED').length;
  const withYou = all.filter((a) => a.status === 'IN_PROGRESS').length;
  // Who to get ready for: today's first customer not yet checked in — late
  // ones too, since a late customer can still walk in — and failing that,
  // the next one booked.
  const expectedRows = todays.filter((a) => a.status === 'BOOKED');
  const lateToday = expectedRows.filter((a) => at(a) < now);
  const nextToday = expectedRows.find((a) => at(a) >= now) ?? null;
  const ahead = all
    .filter((a) => a.status === 'BOOKED' && at(a) >= addDays(today, 1))
    .sort((x, y) => at(x).getTime() - at(y).getTime());
  const next = expectedRows[0] ?? ahead[0] ?? null;

  const real = all.filter((a) => REAL.includes(a.status));
  const inWindow = (start: Date, end: Date) => real.filter((a) => at(a) >= start && at(a) < end).length;
  const lastSeven = inWindow(addDays(today, -6), addDays(today, 1));
  const sevenBefore = inWindow(addDays(today, -13), addDays(today, -6));
  const trend = sevenBefore > 0 ? Math.round(((lastSeven - sevenBefore) / sevenBefore) * 100) : null;

  const rated = (locations.data ?? []).filter((l) => l.ratingCount > 0);
  const ratingCount = rated.reduce((sum, l) => sum + l.ratingCount, 0);
  const rating =
    ratingCount > 0
      ? rated.reduce((sum, l) => sum + Number(l.ratingAvg ?? 0) * l.ratingCount, 0) / ratingCount
      : null;

  const days = useMemo(
    () =>
      Array.from({ length: 21 }, (_, i) => {
        const day = addDays(today, i - 13);
        const count = real.filter((a) => sameDay(at(a), day)).length;
        return { day, count, when: i < 13 ? 'past' : i === 13 ? 'today' : 'future' } as const;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookings.data, today.getTime()],
  );

  const pattern = useMemo(() => {
    const past = real.filter((a) => at(a) < now && at(a) >= from);
    const byWeekday = Array.from({ length: 7 }, () => 0);
    const byHour = Array.from({ length: 24 }, () => 0);
    for (const a of past) {
      byWeekday[at(a).getDay()] += 1;
      byHour[at(a).getHours()] += 1;
    }
    return { total: past.length, byWeekday, byHour };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings.data, today.getTime()]);

  const sentence = (() => {
    const people = (n: number) => `${n} ${n === 1 ? 'customer' : 'customers'}`;
    if (expectedToday > 0 && withYou > 0)
      return `${people(expectedToday)} still expected today, and ${withYou} with you now.`;
    if (expectedToday > 0) return `${people(expectedToday)} still expected today.`;
    if (withYou > 0) return `${withYou} with you now, and nobody else expected today.`;
    if (next) return `Nobody else expected today. Next: ${relativeDay(next.startTime, now).toLowerCase()} at ${clock(next.startTime)}.`;
    return 'Nobody is expected yet — new bookings appear here as they come in.';
  })();

  return (
    <section className="ov">
      <div className="page-top ov-top">
        <header className="ov-head">
          <div>
            <p className="ov-eyebrow">
              <Icon name={now.getHours() < 17 ? 'sun' : 'moon'} size={16} />
              {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              <span className="ov-clock">{clock(now)}</span>
            </p>
            <h1>
              {greeting(now)}, <span>{businessName}</span>
            </h1>
            <p className="ov-sentence">{sentence}</p>
          </div>
          <div className="ov-head-actions">
            <Link to="/closures" className="btn-quiet">
              <Icon name="calendarX" size={18} />
              Take time off
            </Link>
            <Link to="/services" className="btn-dark">
              <Icon name="plus" size={18} stroke={2.2} />
              Add a service
            </Link>
          </div>
        </header>
      </div>

      {/* No room for the "For you" column (§204): on a phone or tablet it sits
          at the top of the home page instead, like the customer app's (§205). */}
      {!wide && <ForYouTop />}

      {complete.error && (
        <p className="notice" role="alert">
          {complete.error instanceof ApiError ? complete.error.message : 'That did not work.'}
        </p>
      )}

      <div className="ov-stats">
        <Stat
          tone="accent"
          icon="calendarCheck"
          label="Still expected today"
          value={expectedToday}
          loading={bookings.isLoading}
          sub={
            lateToday.length > 0
              ? `${lateToday.length} running late${nextToday ? ` · next at ${clock(nextToday.startTime)}` : ''}`
              : nextToday
                ? `Next at ${clock(nextToday.startTime)}`
                : 'Nobody else today'
          }
          action={
            expectedToday > 0 ? (
              <button type="button" className="ov-stat-action" onClick={() => openCheckIn()}>
                Check in <Icon name="arrowRight" size={15} stroke={2.2} />
              </button>
            ) : null
          }
        />
        <Stat
          icon="timer"
          label="With you now"
          value={withYou}
          loading={bookings.isLoading}
          sub={withYou > 0 ? 'Mark them done when finished' : 'Nobody in the chair'}
          to="/appointments?tab=in-progress"
        />
        <Stat
          icon="chart"
          label="Bookings, last 7 days"
          value={lastSeven}
          loading={bookings.isLoading}
          trend={trend}
          sub={trend === null ? 'Counting from this week' : 'vs the 7 days before'}
          to="/analytics"
        />
        <Stat
          icon="star"
          label="Your rating"
          value={rating ?? 0}
          decimals={1}
          empty={rating === null ? 'New' : undefined}
          loading={locations.isLoading}
          sub={ratingCount > 0 ? `from ${ratingCount} ${ratingCount === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}
          to="/reviews"
          stars={rating}
        />
      </div>

      <div className="ov-cols">
        <div className="ov-main">
          <article className="ov-card ov-today">
            <header className="ov-card-head">
              <div>
                <h2>Today’s schedule</h2>
                <p>{todays.length === 0 ? 'Nothing booked for today' : summary(todays)}</p>
              </div>
              <Link to="/appointments" className="ov-link">
                All appointments <Icon name="arrowRight" size={15} stroke={2.2} />
              </Link>
            </header>
            {bookings.isLoading ? (
              <div className="ov-skeletons">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" />
                ))}
              </div>
            ) : todays.length === 0 ? (
              <Empty
                icon="calendar"
                title="A quiet day so far"
                text="When customers book for today, they appear here in time order, each with a button to check them in."
              />
            ) : (
              <Timeline
                items={todays}
                now={now}
                busyId={complete.isPending ? complete.variables : undefined}
                onCheckIn={(a) => openCheckIn(a)}
                onComplete={(a) => complete.mutate(a.id)}
              />
            )}
          </article>
          <article className="ov-card ov-chart">
            <header className="ov-card-head">
              <div>
                <h2>Bookings</h2>
                <p>The last two weeks, and what is booked for the week ahead</p>
              </div>
              <div className="ov-legend">
                <span><i className="lg-past" /> Past</span>
                <span><i className="lg-today" /> Today</span>
                <span><i className="lg-future" /> Booked ahead</span>
              </div>
            </header>
            <Chart days={days} loading={bookings.isLoading} />
          </article>
          <MoneyCard balance={balance.data} loading={balance.isLoading} format={money.format} />
        </div>
        <div className="ov-side">
            <NextUp appointment={next} now={now} onCheckIn={(a) => openCheckIn(a)} money={money.format} />
            <Inbox threads={threads.data?.threads ?? []} loading={threads.isLoading} />
          <article className="ov-card ov-busy">
            <header className="ov-card-head">
              <div>
                <h2>Busiest times</h2>
                <p>From the last four weeks</p>
              </div>
            </header>
            <Busiest pattern={pattern} loading={bookings.isLoading} />
          </article>
        </div>
      </div>

      <div className="ov-row">
        <article className="ov-card ov-reviews">
          <header className="ov-card-head">
            <div>
              <h2>Latest reviews</h2>
              <p>{ratingCount > 0 ? `${ratingCount} in all` : 'What customers say about you'}</p>
            </div>
            <Link to="/reviews" className="ov-link">
              All reviews <Icon name="arrowRight" size={15} stroke={2.2} />
            </Link>
          </header>
          {reviews.isLoading ? (
            <div className="ov-skeletons">
              {[0, 1].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
          ) : (reviews.data ?? []).length === 0 ? (
            <Empty icon="star" title="No reviews yet" text="After a visit, customers can rate you. Their words will show here." />
          ) : (
            <ul className="ov-reviews-list">
              {reviews.data!.map(({ review, branch }) => (
                <ReviewRow key={review.id} review={review} branch={branch} />
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function summary(rows: Appointment[]) {
  const count = (s: AppointmentStatus) => rows.filter((a) => a.status === s).length;
  return [
    count('BOOKED') && `${count('BOOKED')} expected`,
    count('IN_PROGRESS') && `${count('IN_PROGRESS')} in progress`,
    count('COMPLETED') && `${count('COMPLETED')} done`,
    count('NO_SHOW') && `${count('NO_SHOW')} no-show`,
  ]
    .filter(Boolean)
    .join(' · ') || `${rows.length} booked`;
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
  trend,
  to,
  action,
  loading,
  decimals = 0,
  empty,
  stars,
}: {
  icon: IconName;
  label: string;
  value: number;
  sub: string;
  tone?: 'accent';
  trend?: number | null;
  to?: string;
  action?: React.ReactNode;
  loading?: boolean;
  decimals?: number;
  empty?: string;
  stars?: number | null;
}) {
  const shown = useCountUp(loading ? 0 : value);
  const body = (
    <>
      <span className="ov-stat-bg" aria-hidden="true">
        <Icon name={icon} size={120} stroke={1.2} />
      </span>
      <span className="ov-stat-top">
        <span className="ov-stat-icon">
          <Icon name={icon} size={19} />
        </span>
        {trend !== undefined && trend !== null && (
          <span className={`ov-trend ${trend >= 0 ? 'is-up' : 'is-down'}`}>
            <Icon name={trend >= 0 ? 'trendUp' : 'trendDown'} size={13} stroke={2.2} />
            {trend >= 0 ? '+' : ''}
            {trend}%
          </span>
        )}
        {to && !action && <Icon name="arrowUpRight" size={18} className="ov-stat-go" />}
      </span>
      <span className="ov-stat-label">{label}</span>
      <span className="ov-stat-value">
        {loading ? <span className="skeleton ov-stat-skel" /> : empty ?? shown.toFixed(decimals)}
        {stars !== undefined && stars !== null && !loading && <Stars value={stars} size={16} />}
      </span>
      <span className="ov-stat-sub">{sub}</span>
      {action}
    </>
  );
  const cls = `ov-stat${tone ? ` is-${tone}` : ''}`;
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Timeline({
  items,
  now,
  busyId,
  onCheckIn,
  onComplete,
}: {
  items: Appointment[];
  now: Date;
  busyId?: string;
  onCheckIn: (a: Appointment) => void;
  onComplete: (a: Appointment) => void;
}) {
  const nowIndex = items.findIndex((a) => new Date(a.startTime) > now);
  const marker = (
    <li className="tl-now" key="now" aria-label={`Now, ${clock(now)}`}>
      <span>Now · {clock(now)}</span>
    </li>
  );
  const rows = items.map((a) => {
    const look = STATUS[a.status];
    const late = a.status === 'BOOKED' && new Date(a.startTime) < now;
    return (
      <li key={a.id} className={`tl-item is-${look.cls}${late ? ' is-late' : ''}`}>
        <div className="tl-time">
          <strong>{clock(a.startTime)}</strong>
          <span>{minutesBetween(a.startTime, a.endTime)} min</span>
        </div>
        <div className="tl-rail" aria-hidden="true">
          <i />
        </div>
        <div className="tl-card">
          <Avatar label={a.customer.email} size={40} />
          <div className="tl-who">
            <strong>{a.customer.email}</strong>
            <span>
              {a.service.name}
              {a.quantity > 1 ? ` · ${a.quantity} people` : ''} · {a.location.name}
            </span>
          </div>
          <span className={`pill ${late ? 'late' : look.cls}`}>
            {late ? `${span((now.getTime() - new Date(a.startTime).getTime()) / 60_000)} late` : look.label}
          </span>
          <div className="tl-action">
            {a.status === 'BOOKED' && (
              <button type="button" className="primary tl-btn" onClick={() => onCheckIn(a)}>
                <Icon name="ticket" size={16} /> Check in
              </button>
            )}
            {a.status === 'IN_PROGRESS' && (
              <button type="button" className="dark tl-btn" disabled={busyId === a.id} onClick={() => onComplete(a)}>
                <Icon name="check" size={16} stroke={2.4} /> {busyId === a.id ? 'Saving…' : 'Mark done'}
              </button>
            )}
            {a.status === 'COMPLETED' && (
              <span className="tl-done">
                <Icon name="checkCircle" size={18} /> Done
              </span>
            )}
          </div>
        </div>
      </li>
    );
  });
  if (nowIndex === -1) rows.push(marker);
  else rows.splice(nowIndex, 0, marker);
  return <ol className="timeline">{rows}</ol>;
}

function NextUp({
  appointment,
  now,
  onCheckIn,
  money,
}: {
  appointment: Appointment | null;
  now: Date;
  onCheckIn: (a: Appointment) => void;
  money: (minor: number | null | undefined, code?: string | null) => string;
}) {
  if (!appointment) {
    return (
      <article className="ov-next is-empty">
        <p className="ov-next-label">Next up</p>
        <h3>Nobody expected</h3>
        <p className="ov-next-text">Your next customer will show here, with a countdown to their time.</p>
      </article>
    );
  }
  const minutes = (new Date(appointment.startTime).getTime() - now.getTime()) / 60_000;
  const today = sameDay(new Date(appointment.startTime), now);
  const countdown =
    !today ? relativeDay(appointment.startTime, now) : Math.abs(minutes) <= 10 ? 'Due now' : minutes > 0 ? `in ${span(minutes)}` : `${span(minutes)} late`;
  const due =
    appointment.servicePriceMinor !== null
      ? Math.max(0, appointment.servicePriceMinor - appointment.depositAmountMinor)
      : null;
  return (
    <article className="ov-next">
      <div className="ov-next-top">
        <p className="ov-next-label">Next up</p>
        <span className={`ov-next-count ${today && Math.abs(minutes) <= 10 ? 'is-now' : today && minutes < 0 ? 'is-late' : ''}`}>
          {countdown}
        </span>
      </div>
      <div className="ov-next-who">
        <Avatar label={appointment.customer.email} size={54} />
        <div>
          <h3>{appointment.customer.email}</h3>
          <p>
            {appointment.service.name}
            {appointment.quantity > 1 ? ` · ${appointment.quantity} people` : ''}
          </p>
        </div>
      </div>
      <dl className="ov-next-facts">
        <div>
          <dt>When</dt>
          <dd>
            {today ? '' : `${shortDay(appointment.startTime)}, `}
            {clock(appointment.startTime)} – {clock(appointment.endTime)}
          </dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{appointment.location.name}</dd>
        </div>
        {due !== null && (
          <div>
            <dt>To pay at the shop</dt>
            <dd>{money(due, appointment.currency)}</dd>
          </div>
        )}
      </dl>
      <button type="button" className="ov-next-btn" onClick={() => onCheckIn(appointment)}>
        <Icon name="ticket" size={18} /> Check them in
      </button>
    </article>
  );
}

function Inbox({ threads, loading }: { threads: Thread[]; loading: boolean }) {
  const recent = [...threads]
    .filter((t) => t.lastMessageAt)
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
    .slice(0, 3);
  const unread = threads.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0);
  return (
    <article className="ov-card ov-inbox">
      <header className="ov-card-head">
        <div>
          <h2>
            Messages {unread > 0 && <span className="ov-count">{unread} new</span>}
          </h2>
          <p>Questions from customers</p>
        </div>
        <Link to="/messages" className="ov-link">
          Open <Icon name="arrowRight" size={15} stroke={2.2} />
        </Link>
      </header>
      {loading ? (
        <div className="ov-skeletons">
          <div className="skeleton" />
        </div>
      ) : recent.length === 0 ? (
        <Empty icon="message" title="No messages yet" text="When a customer asks something, it lands here." small />
      ) : (
        <ul className="ov-threads">
          {recent.map((t) => (
            <li key={t.id}>
              <Link
                to={`/messages?thread=${encodeURIComponent(t.id)}`}
                className={`ov-thread${t.unreadCount > 0 ? ' is-unread' : ''}`}
              >
                <Avatar label={t.customer?.email ?? 'Customer'} size={38} />
                <span className="ov-thread-text">
                  <strong>{t.customer?.email ?? 'Customer'}</strong>
                  <span>
                    {t.lastMessage?.hasPhoto && (!t.lastMessage.preview || t.lastMessage.preview === '[photo]')
                      ? 'Sent a photo'
                      : t.lastMessage?.preview ?? ''}
                  </span>
                </span>
                <span className="ov-thread-meta">
                  <span>{t.lastMessageAt ? ago(t.lastMessageAt) : ''}</span>
                  {t.unreadCount > 0 && <i>{t.unreadCount}</i>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Chart({
  days,
  loading,
}: {
  days: ReadonlyArray<{ day: Date; count: number; when: 'past' | 'today' | 'future' }>;
  loading: boolean;
}) {
  const max = Math.max(4, ...days.map((d) => d.count));
  const top = Math.ceil(max / 2) * 2;
  const total = days.filter((d) => d.when !== 'future').reduce((s, d) => s + d.count, 0);
  const ahead = days.filter((d) => d.when === 'future').reduce((s, d) => s + d.count, 0);
  return (
    <div className="chart">
      <div className="chart-figures">
        <div>
          <strong>{loading ? '–' : total}</strong>
          <span>in the last two weeks</span>
        </div>
        <div>
          <strong>{loading ? '–' : ahead}</strong>
          <span>booked for the week ahead</span>
        </div>
      </div>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {[top, top / 2, 0].map((v) => (
            <span key={v}>
              <em>{v}</em>
            </span>
          ))}
        </div>
        <div className="chart-bars">
          {days.map((d, i) => (
            <div key={i} className={`bar-col is-${d.when}`}>
              <div className="bar-track">
                <div
                  className="bar"
                  style={{ height: `${loading ? 0 : Math.max(d.count ? 6 : 0, (d.count / top) * 100)}%`, animationDelay: `${i * 22}ms` }}
                >
                  <span className="bar-tip">
                    {d.count} {d.count === 1 ? 'booking' : 'bookings'}
                    <em>{shortDay(d.day)}</em>
                  </span>
                </div>
              </div>
              <span className="bar-label">
                {d.when === 'today' ? 'Today' : i % 2 === 1 ? d.day.getDate() : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Busiest({
  pattern,
  loading,
}: {
  pattern: { total: number; byWeekday: number[]; byHour: number[] };
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="ov-skeletons">
        <div className="skeleton" />
      </div>
    );
  }
  if (pattern.total < 3) {
    return (
      <Empty
        icon="chart"
        title="Not enough yet"
        text="After a few more bookings, this shows the days and hours customers like best."
        small
      />
    );
  }
  // Monday first, the way a working week is read.
  const week = [1, 2, 3, 4, 5, 6, 0].map((d) => pattern.byWeekday[d]);
  const peakDay = pattern.byWeekday.indexOf(Math.max(...pattern.byWeekday));
  const maxDay = Math.max(...week);
  // The working day, 06:00 to 22:00 — the strip shows these, and the peak is
  // read from them, so the headline always names an hour the strip shows.
  const hours = Array.from({ length: 16 }, (_, i) => i + 6);
  const maxHour = Math.max(...hours.map((h) => pattern.byHour[h]));
  const peakHour = hours.find((h) => pattern.byHour[h] === maxHour) ?? 9;
  return (
    <div className="busy">
      <p className="busy-headline">
        <strong>{WEEKDAY_NAMES[peakDay]}</strong> are your busiest, most often around{' '}
        <strong>{String(peakHour).padStart(2, '0')}:00</strong>.
      </p>
      <div className="busy-week">
        {week.map((count, i) => {
          const isPeak = [1, 2, 3, 4, 5, 6, 0][i] === peakDay;
          return (
            <div key={i} className={`busy-day${isPeak ? ' is-peak' : ''}`} title={`${count} on ${WEEKDAYS[i]}`}>
              <div className="busy-track">
                <div className="busy-bar" style={{ height: `${maxDay ? Math.max(8, (count / maxDay) * 100) : 8}%` }} />
              </div>
              <span>{WEEKDAYS[i].slice(0, 1)}</span>
            </div>
          );
        })}
      </div>
      <div className="busy-hours" aria-label="Bookings by hour of the day">
        {hours.map((h) => (
          <span
            key={h}
            className={h === peakHour ? 'is-peak' : ''}
            style={{ opacity: maxHour ? 0.12 + (pattern.byHour[h] / maxHour) * 0.88 : 0.12 }}
            title={`${String(h).padStart(2, '0')}:00 — ${pattern.byHour[h]}`}
          />
        ))}
      </div>
      <div className="busy-hour-labels">
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>22:00</span>
      </div>
    </div>
  );
}

function MoneyCard({
  balance,
  loading,
  format,
}: {
  balance: Balance | undefined;
  loading: boolean;
  format: (minor: number | null | undefined, code?: string | null) => string;
}) {
  const ready = useCountUp(balance?.availableNowMinor ?? 0);
  if (!loading && !balance) return null;
  return (
    <article className="ov-card ov-money">
      <header className="ov-card-head">
        <div>
          <h2>Money</h2>
          <p>Your share of deposits, paid to your mobile money</p>
        </div>
        <Link to="/getting-paid" className="ov-link">
          Getting paid <Icon name="arrowRight" size={15} stroke={2.2} />
        </Link>
      </header>
      <div className="money-body">
      <div className="money-hero">
        <span className="money-icon">
          <Icon name="wallet" size={22} />
        </span>
        <div>
          <span>Ready for your next payout</span>
          <strong>{loading ? '–' : format(Math.round(ready), balance?.currency)}</strong>
        </div>
      </div>
      <div className="money-split">
        <div>
          <span>Still settling</span>
          <strong>{loading ? '–' : format(balance?.pendingMinor, balance?.currency)}</strong>
        </div>
        <div>
          <span>Paid to you so far</span>
          <strong>{loading ? '–' : format(balance?.lifetimePaidMinor, balance?.currency)}</strong>
        </div>
      </div>
      </div>
      {balance?.payoutsPaused && (
        <p className="money-paused">
          <Icon name="pause" size={15} />
          Payouts are paused — see Getting paid for why.
        </p>
      )}
    </article>
  );
}

function ReviewRow({ review, branch }: { review: Review; branch: string }) {
  return (
    <li className="ov-review">
      <div className="ov-review-head">
        <Avatar label={review.displayName ?? review.customer?.email ?? 'Anonymous'} size={36} />
        <div>
          <strong>{review.displayName ?? 'Anonymous'}</strong>
          <span>
            {branch} · {ago(review.createdAt)}
          </span>
        </div>
        <Stars value={review.rating} size={14} />
      </div>
      {review.comment && <p>{review.comment}</p>}
      {!review.responseText && <span className="ov-review-reply">Not replied yet</span>}
    </li>
  );
}

function Empty({ icon, title, text, small = false }: { icon: IconName; title: string; text: string; small?: boolean }) {
  return (
    <div className={`ov-empty${small ? ' is-small' : ''}`}>
      <span>
        <Icon name={icon} size={small ? 22 : 28} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
