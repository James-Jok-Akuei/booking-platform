import type { IconName } from '../ui/Icon';
import type { SlideEffect } from './Effects';
import { lookFor, type Tone } from '../lib/notificationLook';
import { ago } from '../lib/time';
import { guideTopics } from './guide';
import { searchHow } from './tips';
import type { AdData, JustIn } from './useAdData';
import { t } from '@lingui/core/macro';

/**
 * The adverts in the "For you" banner (§204), most useful first.
 *
 * Three kinds, mixed: **about your shop** (what is missing, what sells, what is
 * waiting for you), **from the platform** (what customers are booking, that
 * you can book too, how the app ranks shops) and **how to use the app** (a
 * feature worth knowing). Every claim is something the app actually does; no
 * figure is made up.
 */

export type SlideLook = 'coral' | 'night' | 'green' | 'gold' | 'blue' | 'violet' | 'amber';

export type Slide = {
  key: string;
  look: SlideLook;
  icon: IconName;
  eyebrow: string;
  title: string;
  text: string;
  image?: string | null;
  /** A number worth putting big in the corner. */
  stat?: { value: string; label: string };
  cta?: { label: string; to?: string; href?: string; scrollTo?: string };
  /** The card's own moving effect (§212), chosen for what it is about. */
  effect?: SlideEffect;
  /**
   * The point in one short line (§225) — what the slim banner shows under the
   * title, where there is no room for `text`: "Press ⌘ K, then type a word".
   */
  gist?: string;
};

/** A link to the customer app, when there is one to give (VITE_CUSTOMER_APP_URL). */
export const CUSTOMER_APP_URL = (import.meta.env.VITE_CUSTOMER_APP_URL as string | undefined)?.trim() || null;

/** The two rules the banner teaches, each in one line (§225). */
const LEARN_GIST: Record<string, string> = {
  get cancel() { return t`Customer cancels: deposit kept · You cancel: full refund`; },
  get photos() { return t`Up to 11 per service · the first one is the cover`; },
};

export function buildSlides(d: AdData): Slide[] {
  const slides: Slide[] = [];

  // Just in (§206): the one newest thing — first, while it is still news.
  const news = d.justIn ? justInSlide(d.justIn) : null;
  if (news) slides.push(news);

  // Money first: nothing else matters if the seller cannot be paid. Only the
  // owner can set the number (§48), so only the owner is asked to.
  if (d.access.isOwner && d.payoutStatus && d.payoutStatus !== 'VERIFIED' && d.payoutStatus !== 'SUPERSEDED') {
    slides.push({
      key: 'payout',
      effect: 'coins',
      gist: d.payoutStatus === 'UNVERIFIED' ? t`Payouts start as soon as it is confirmed` : t`Your share is held until you add one`,
      look: 'amber',
      icon: 'wallet',
      eyebrow: t`Get paid`,
      title:
        d.payoutStatus === 'UNVERIFIED'
          ? t`Your payout number is being checked`
          : d.payoutStatus === 'REJECTED'
            ? t`Your payout number was not accepted`
            : t`Add the number we pay you on`,
      text:
        d.payoutStatus === 'UNVERIFIED'
          ? t`Payouts start as soon as an administrator confirms it. Nothing you earn is lost meanwhile.`
          : t`Your share of every deposit is held until there is a confirmed mobile money number to send it to.`,
      cta: { label: d.payoutStatus === 'UNVERIFIED' ? t`See your money` : t`Add it now`, to: '/getting-paid' },
    });
  }

  if (d.best) {
    slides.push({
      key: 'best',
      effect: 'confetti',
      gist: t`${d.best.count} ${d.best.count === 1 ? 'booking' : 'bookings'} in 30 days${d.best.onSale ? ' · discount on now' : d.access.runsBusiness ? ' · try a discount' : ''}`,
      look: 'coral',
      icon: 'trendUp',
      eyebrow: t`Your best seller`,
      title: d.best.name,
      text: d.best.onSale
        ? t`Your most booked service of the last 30 days — and it has a discount on.`
        : d.access.runsBusiness
          ? t`Your most booked service of the last 30 days. A short discount could bring in even more.`
          : t`Your most booked service of the last 30 days.`,
      image: d.best.service?.images[0]?.url ?? null,
      stat: { value: String(d.best.count), label: d.best.count === 1 ? t`booking` : t`bookings` },
      cta: {
        label: d.best.onSale || !d.access.runsBusiness ? t`See your services` : t`Give it a discount`,
        to: '/services',
      },
    });
  }

  const trend = d.trendingSame[0] ?? d.trendingEverywhere[0];
  if (trend) {
    const inKind = d.trendingSame[0] === trend && d.subcategoryName;
    slides.push({
      key: 'trending',
      effect: 'streaks',
      gist: t`${trend.bookingCount} booked · ${trend.business.name ?? trend.location.name}`,
      look: 'violet',
      icon: 'zap',
      eyebrow: inKind ? t`Trending in ${d.subcategoryName ?? ""}` : t`Trending on the app`,
      title: trend.name,
      text: t`${trend.business.name ?? trend.location.name} · ${trend.location.district?.name ?? trend.location.name}. See what customers are booking — and what makes it stand out.`,
      image: trend.imageUrl,
      stat: { value: String(trend.bookingCount), label: trend.bookingCount === 1 ? t`booking` : t`bookings` },
      cta: { label: t`See what is trending`, scrollTo: 'ads-trending' },
    });
  }

  // Filling in the shop is for those who may change it (§277).
  if (d.missing.length > 0 && d.access.runsBusiness) {
    slides.push({
      key: 'health',
      effect: 'constellation',
      gist: t`${d.score}% done · next: ${d.missing[0].label.toLowerCase()}`,
      look: 'night',
      icon: 'sparkles',
      eyebrow: t`Make your shop stand out`,
      title: t`${d.missing.length} ${d.missing.length === 1 ? 'thing' : 'things'} left to add`,
      text: t`Start with ${d.missing[0].label.toLowerCase()}: ${d.missing[0].why.charAt(0).toLowerCase()}${d.missing[0].why.slice(1)}`,
      stat: { value: `${d.score}%`, label: t`complete` },
      cta: { label: t`Add it now`, to: d.missing[0].to },
    });
  }

  if (d.unanswered > 0) {
    slides.push({
      key: 'reviews',
      effect: 'stars',
      gist: t`Your reply shows under the review, for everyone`,
      look: 'gold',
      icon: 'star',
      eyebrow: t`Customers are waiting`,
      title: t`${d.unanswered} ${d.unanswered === 1 ? 'review is' : 'reviews are'} waiting for a reply`,
      text: t`Your reply sits under the review for everyone who reads it — the next customer reads both.`,
      cta: { label: t`Reply now`, to: '/reviews' },
    });
  }

  // More than one shop (§206). Only the owner, or a manager of every branch,
  // can add one (§277).
  if (d.access.runsBusiness) {
    slides.push({
      key: 'branches',
      effect: 'waves',
      gist: d.branchCount === 0 ? t`Address, map pin, hours — then customers can book` : t`Each gets its own page, hours and prices`,
      look: 'green',
      icon: 'store',
      eyebrow: t`Grow · Branches`,
      title: d.branchCount === 0 ? t`Add the place you work from` : t`Have another shop? Add it as a branch`,
      text:
        d.branchCount === 0
          ? t`Until there is a branch, there is nothing for customers to book. Add its address, pin it on the map, then set its hours.`
          : t`Another street, district or town — each branch gets its own page, hours, photos and prices, and customers near it find it on its own.`,
      stat: d.branchCount > 1 ? { value: String(d.branchCount), label: t`branches` } : undefined,
      cta: { label: t`Add a branch`, to: '/hours?add=1' },
    });
  }

  slides.push({
    key: 'buyer',
    effect: 'bubbles',
    gist: t`Sign up in our customer app with your personal email`,
    look: 'blue',
    icon: 'phone',
    eyebrow: t`From us · You can book too`,
    title: t`Need a haircut, a massage, a repair?`,
    // A business account cannot book (§50: one email, one kind of account), so
    // the honest invitation is a personal email in the customer app.
    text: CUSTOMER_APP_URL
      ? t`Get our customer app and book any shop on the platform. Sign up there with your personal email.`
      : t`Our customer app lets you book any shop on the platform — sign up there with your personal email. It is coming to the app stores.`,
    cta: CUSTOMER_APP_URL ? { label: t`Get the app`, href: CUSTOMER_APP_URL } : undefined,
  });

  slides.push({
    key: 'rank',
    effect: 'rays',
    gist: t`Bookings × rating decide where you appear`,
    look: 'green',
    icon: 'chart',
    eyebrow: t`How customers find you`,
    title: t`Popular shops are shown first`,
    text: t`The app ranks shops by their bookings, weighted by their rating. Good reviews and a full page move you up.`,
    cta: d.access.insights ? { label: t`See how it is going`, to: '/analytics' } : undefined,
  });

  if (d.hasServices && !d.saleRunning && d.access.runsBusiness) {
    slides.push({
      key: 'sale',
      effect: 'glitter',
      gist: t`1–90% off · customers see a −% badge`,
      look: 'coral',
      icon: 'percent',
      eyebrow: t`Idea`,
      title: t`Run a discount this week`,
      text: t`A discounted service shows its −% badge and the old price crossed out, and the app has a spotlight for discounts.`,
      cta: { label: t`Start a discount`, to: '/services' },
    });
  }

  // How it works: the two rules sellers most often learn the hard way.
  for (const topic of guideTopics(d.feePercent).filter((t) => t.key === 'cancel' || t.key === 'photos')) {
    slides.push({
      key: `learn-${topic.key}`,
      effect: topic.key === 'cancel' ? 'aurora' : 'bokeh',
      gist: LEARN_GIST[topic.key] ?? topic.points[0],
      look: topic.key === 'cancel' ? 'night' : 'blue',
      icon: topic.icon,
      eyebrow: t`How it works · ${topic.title}`,
      title: topic.short,
      text: topic.points[1] ?? topic.points[0],
      cta: { label: t`Read more`, scrollTo: `guide-${topic.key}` },
    });
  }

  slides.push({
    key: 'tip-search',
    effect: 'meteors',
    gist: t`${searchHow()}, then type a word like “prices”`,
    look: 'night',
    icon: 'search',
    eyebrow: t`Tip`,
    title: t`Jump to anything`,
    text: t`${searchHow()} and type any word — “prices”, “holiday”, “momo” — to go straight to the page you need.`,
  });

  return slides.slice(0, 11);
}

/** Where each kind of notice leads, said as a button. */
const ACTION: Record<string, string> = {
  get '/appointments'() { return t`See your bookings`; },
  get '/reviews'() { return t`See your reviews`; },
  get '/messages'() { return t`Reply`; },
  get '/getting-paid'() { return t`See your money`; },
  get '/profile'() { return t`See your shopfront`; },
  get '/help'() { return t`Open Help`; },
  get '/people'() { return t`See your team`; },
};

/**
 * What a notice means and what happens next, in one or two sentences. The
 * notice's own body is an e-mail's worth of words; its subject is the title.
 */
const MEANING: Record<string, string> = {
  get APPOINTMENT_BOOKED() { return t`A customer has booked. It shows under “Expected” as soon as their deposit is paid.`; },
  get DEPOSIT_CONFIRMED() { return t`The deposit is paid. They read out their 6-digit code when they arrive — the sixth digit checks them in.`; },
  get APPOINTMENT_CANCELLED() { return t`The time is free again for someone else. Who cancelled decides what happens to the deposit.`; },
  get APPOINTMENT_NO_SHOW() { return t`The deposit is not refunded, and your share of it is paid to you.`; },
  get APPOINTMENT_REMINDER() { return t`A booking is coming up. Ask for their 6-digit code when they arrive.`; },
  get DEPOSIT_FAILED() { return t`The payment did not go through. The customer can try again.`; },
  get NEW_MESSAGE() { return t`A customer wrote to you. A shop cannot start a conversation, so a quick reply is the chance to win the booking.`; },
  get REVIEW_CREATED() { return t`A customer reviewed you. Your reply shows under it for everyone, and you can edit it for 7 days.`; },
  get REVIEW_RESPONSE() { return t`Your reply is under the review for everyone to read.`; },
  get REVIEW_HIDDEN() { return t`An administrator hid a review. It no longer counts in your rating.`; },
  get BUSINESS_APPROVED() { return t`Customers cannot see it yet — post your shop from your Overview when you are ready.`; },
  get BUSINESS_REINSTATED() { return t`Your shop is public again — customers can find it and book.`; },
  get BUSINESS_REJECTED() { return t`Open it to read the reason.`; },
  get BUSINESS_SUSPENDED() { return t`Open it to read the reason.`; },
  get PAYOUT_DESTINATION_VERIFIED() { return t`Your share of deposits can now be paid to it in the daily payout run.`; },
  get PAYOUT_DESTINATION_REJECTED() { return t`Open it to read the reason, then add a number again.`; },
  get TICKET_MESSAGE() { return t`There is a reply to your help request.`; },
  get TICKET_STATUS_CHANGED() { return t`Your help request has moved on.`; },
};

const LOOK_BY_TONE: Record<Tone, SlideLook> = {
  ok: 'green',
  ask: 'blue',
  danger: 'night',
  warn: 'amber',
  star: 'gold',
  accent: 'coral',
};

function justInSlide(j: JustIn): Slide {
  if (j.kind === 'message') {
    const thread = j.thread;
    return {
      key: 'just-in',
      effect: 'ripples',
      gist: `“${thread.lastMessage?.preview ?? t`Sent a photo`}”`,
      look: 'coral',
      icon: 'message',
      eyebrow: t`Just in · ${thread.lastMessageAt ? ago(thread.lastMessageAt) : t`now`}`,
      title: t`${thread.customer.email} wrote to you`,
      text: t`“${thread.lastMessage?.preview ?? t`Sent a photo`}” — a quick reply is the chance to win the booking.`,
      cta: { label: t`Reply`, to: `/messages?thread=${encodeURIComponent(thread.id)}` },
    };
  }
  const n = j.notification;
  const look = lookFor(n.type);
  return {
    key: 'just-in',
    effect: 'ripples',
    gist: (MEANING[n.type] ?? 'Open it to see the details.').split('. ')[0].replace(/\.$/, ''),
    look: LOOK_BY_TONE[look.tone],
    icon: look.icon,
    eyebrow: t`Just in · ${ago(n.createdAt)}`,
    title: n.subject ?? t`Something new`,
    text: MEANING[n.type] ?? t`Open it to see the details.`,
    cta: { label: ACTION[look.to.split('?')[0]] ?? t`Open it`, to: look.to },
  };
}
