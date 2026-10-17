import type { IconName } from '../ui/Icon';
import type { SlideEffect } from './Effects';
import { lookFor, type Tone } from '../lib/notificationLook';
import { ago } from '../lib/time';
import { guideTopics } from './guide';
import { SEARCH_HOW } from './tips';
import type { AdData, JustIn } from './useAdData';

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
  cancel: 'Customer cancels: deposit kept · You cancel: full refund',
  photos: 'Up to 11 per service · the first one is the cover',
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
      gist: d.payoutStatus === 'UNVERIFIED' ? 'Payouts start as soon as it is confirmed' : 'Your share is held until you add one',
      look: 'amber',
      icon: 'wallet',
      eyebrow: 'Get paid',
      title:
        d.payoutStatus === 'UNVERIFIED'
          ? 'Your payout number is being checked'
          : d.payoutStatus === 'REJECTED'
            ? 'Your payout number was not accepted'
            : 'Add the number we pay you on',
      text:
        d.payoutStatus === 'UNVERIFIED'
          ? 'Payouts start as soon as an administrator confirms it. Nothing you earn is lost meanwhile.'
          : 'Your share of every deposit is held until there is a confirmed mobile money number to send it to.',
      cta: { label: d.payoutStatus === 'UNVERIFIED' ? 'See your money' : 'Add it now', to: '/getting-paid' },
    });
  }

  if (d.best) {
    slides.push({
      key: 'best',
      effect: 'confetti',
      gist: `${d.best.count} ${d.best.count === 1 ? 'booking' : 'bookings'} in 30 days${d.best.onSale ? ' · discount on now' : d.access.runsBusiness ? ' · try a discount' : ''}`,
      look: 'coral',
      icon: 'trendUp',
      eyebrow: 'Your best seller',
      title: d.best.name,
      text: d.best.onSale
        ? 'Your most booked service of the last 30 days — and it has a discount on.'
        : d.access.runsBusiness
          ? 'Your most booked service of the last 30 days. A short discount could bring in even more.'
          : 'Your most booked service of the last 30 days.',
      image: d.best.service?.images[0]?.url ?? null,
      stat: { value: String(d.best.count), label: d.best.count === 1 ? 'booking' : 'bookings' },
      cta: {
        label: d.best.onSale || !d.access.runsBusiness ? 'See your services' : 'Give it a discount',
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
      gist: `${trend.bookingCount} booked · ${trend.business.name ?? trend.location.name}`,
      look: 'violet',
      icon: 'zap',
      eyebrow: inKind ? `Trending in ${d.subcategoryName}` : 'Trending on the app',
      title: trend.name,
      text: `${trend.business.name ?? trend.location.name} · ${trend.location.district?.name ?? trend.location.name}. See what customers are booking — and what makes it stand out.`,
      image: trend.imageUrl,
      stat: { value: String(trend.bookingCount), label: trend.bookingCount === 1 ? 'booking' : 'bookings' },
      cta: { label: 'See what is trending', scrollTo: 'ads-trending' },
    });
  }

  // Filling in the shop is for those who may change it (§277).
  if (d.missing.length > 0 && d.access.runsBusiness) {
    slides.push({
      key: 'health',
      effect: 'constellation',
      gist: `${d.score}% done · next: ${d.missing[0].label.toLowerCase()}`,
      look: 'night',
      icon: 'sparkles',
      eyebrow: 'Make your shop stand out',
      title: `${d.missing.length} ${d.missing.length === 1 ? 'thing' : 'things'} left to add`,
      text: `Start with ${d.missing[0].label.toLowerCase()}: ${d.missing[0].why.charAt(0).toLowerCase()}${d.missing[0].why.slice(1)}`,
      stat: { value: `${d.score}%`, label: 'complete' },
      cta: { label: 'Add it now', to: d.missing[0].to },
    });
  }

  if (d.unanswered > 0) {
    slides.push({
      key: 'reviews',
      effect: 'stars',
      gist: 'Your reply shows under the review, for everyone',
      look: 'gold',
      icon: 'star',
      eyebrow: 'Customers are waiting',
      title: `${d.unanswered} ${d.unanswered === 1 ? 'review is' : 'reviews are'} waiting for a reply`,
      text: 'Your reply sits under the review for everyone who reads it — the next customer reads both.',
      cta: { label: 'Reply now', to: '/reviews' },
    });
  }

  // More than one shop (§206). Only the owner, or a manager of every branch,
  // can add one (§277).
  if (d.access.runsBusiness) {
    slides.push({
      key: 'branches',
      effect: 'waves',
      gist: d.branchCount === 0 ? 'Address, map pin, hours — then customers can book' : 'Each gets its own page, hours and prices',
      look: 'green',
      icon: 'store',
      eyebrow: 'Grow · Branches',
      title: d.branchCount === 0 ? 'Add the place you work from' : 'Have another shop? Add it as a branch',
      text:
        d.branchCount === 0
          ? 'Until there is a branch, there is nothing for customers to book. Add its address, pin it on the map, then set its hours.'
          : 'Another street, district or town — each branch gets its own page, hours, photos and prices, and customers near it find it on its own.',
      stat: d.branchCount > 1 ? { value: String(d.branchCount), label: 'branches' } : undefined,
      cta: { label: 'Add a branch', to: '/hours?add=1' },
    });
  }

  slides.push({
    key: 'buyer',
    effect: 'bubbles',
    gist: 'Sign up in our customer app with your personal email',
    look: 'blue',
    icon: 'phone',
    eyebrow: 'From us · You can book too',
    title: 'Need a haircut, a massage, a repair?',
    // A business account cannot book (§50: one email, one kind of account), so
    // the honest invitation is a personal email in the customer app.
    text: CUSTOMER_APP_URL
      ? 'Get our customer app and book any shop on the platform. Sign up there with your personal email.'
      : 'Our customer app lets you book any shop on the platform — sign up there with your personal email. It is coming to the app stores.',
    cta: CUSTOMER_APP_URL ? { label: 'Get the app', href: CUSTOMER_APP_URL } : undefined,
  });

  slides.push({
    key: 'rank',
    effect: 'rays',
    gist: 'Bookings × rating decide where you appear',
    look: 'green',
    icon: 'chart',
    eyebrow: 'How customers find you',
    title: 'Popular shops are shown first',
    text: 'The app ranks shops by their bookings, weighted by their rating. Good reviews and a full page move you up.',
    cta: d.access.insights ? { label: 'See how it is going', to: '/analytics' } : undefined,
  });

  if (d.hasServices && !d.saleRunning && d.access.runsBusiness) {
    slides.push({
      key: 'sale',
      effect: 'glitter',
      gist: '1–90% off · customers see a −% badge',
      look: 'coral',
      icon: 'percent',
      eyebrow: 'Idea',
      title: 'Run a discount this week',
      text: 'A discounted service shows its −% badge and the old price crossed out, and the app has a spotlight for discounts.',
      cta: { label: 'Start a discount', to: '/services' },
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
      eyebrow: `How it works · ${topic.title}`,
      title: topic.short,
      text: topic.points[1] ?? topic.points[0],
      cta: { label: 'Read more', scrollTo: `guide-${topic.key}` },
    });
  }

  slides.push({
    key: 'tip-search',
    effect: 'meteors',
    gist: `${SEARCH_HOW}, then type a word like “prices”`,
    look: 'night',
    icon: 'search',
    eyebrow: 'Tip',
    title: 'Jump to anything',
    text: `${SEARCH_HOW} and type any word — “prices”, “holiday”, “momo” — to go straight to the page you need.`,
  });

  return slides.slice(0, 11);
}

/** Where each kind of notice leads, said as a button. */
const ACTION: Record<string, string> = {
  '/appointments': 'See your bookings',
  '/reviews': 'See your reviews',
  '/messages': 'Reply',
  '/getting-paid': 'See your money',
  '/profile': 'See your shopfront',
  '/help': 'Open Help',
  '/people': 'See your team',
};

/**
 * What a notice means and what happens next, in one or two sentences. The
 * notice's own body is an e-mail's worth of words; its subject is the title.
 */
const MEANING: Record<string, string> = {
  APPOINTMENT_BOOKED: 'A customer has booked. It shows under “Expected” as soon as their deposit is paid.',
  DEPOSIT_CONFIRMED: 'The deposit is paid. They read out their 6-digit code when they arrive — the sixth digit checks them in.',
  APPOINTMENT_CANCELLED: 'The time is free again for someone else. Who cancelled decides what happens to the deposit.',
  APPOINTMENT_NO_SHOW: 'The deposit is not refunded, and your share of it is paid to you.',
  APPOINTMENT_REMINDER: 'A booking is coming up. Ask for their 6-digit code when they arrive.',
  DEPOSIT_FAILED: 'The payment did not go through. The customer can try again.',
  NEW_MESSAGE: 'A customer wrote to you. A shop cannot start a conversation, so a quick reply is the chance to win the booking.',
  REVIEW_CREATED: 'A customer reviewed you. Your reply shows under it for everyone, and you can edit it for 7 days.',
  REVIEW_RESPONSE: 'Your reply is under the review for everyone to read.',
  REVIEW_HIDDEN: 'An administrator hid a review. It no longer counts in your rating.',
  BUSINESS_APPROVED: 'Customers cannot see it yet — post your shop from your Overview when you are ready.',
  BUSINESS_REINSTATED: 'Your shop is public again — customers can find it and book.',
  BUSINESS_REJECTED: 'Open it to read the reason.',
  BUSINESS_SUSPENDED: 'Open it to read the reason.',
  PAYOUT_DESTINATION_VERIFIED: 'Your share of deposits can now be paid to it in the daily payout run.',
  PAYOUT_DESTINATION_REJECTED: 'Open it to read the reason, then add a number again.',
  TICKET_MESSAGE: 'There is a reply to your help request.',
  TICKET_STATUS_CHANGED: 'Your help request has moved on.',
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
    const t = j.thread;
    return {
      key: 'just-in',
      effect: 'ripples',
      gist: `“${t.lastMessage?.preview ?? 'Sent a photo'}”`,
      look: 'coral',
      icon: 'message',
      eyebrow: `Just in · ${t.lastMessageAt ? ago(t.lastMessageAt) : 'now'}`,
      title: `${t.customer.email} wrote to you`,
      text: `“${t.lastMessage?.preview ?? 'Sent a photo'}” — a quick reply is the chance to win the booking.`,
      cta: { label: 'Reply', to: `/messages?thread=${encodeURIComponent(t.id)}` },
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
    eyebrow: `Just in · ${ago(n.createdAt)}`,
    title: n.subject ?? 'Something new',
    text: MEANING[n.type] ?? 'Open it to see the details.',
    cta: { label: ACTION[look.to.split('?')[0]] ?? 'Open it', to: look.to },
  };
}
