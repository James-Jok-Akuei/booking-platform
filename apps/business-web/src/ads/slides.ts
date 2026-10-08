import type { IconName } from '../ui/Icon';
import { ago } from '../lib/time';
import { guideTopics } from './guide';
import { SEARCH_HOW } from './tips';
import type { AdData } from './useAdData';

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
};

/** A link to the customer app, when there is one to give (VITE_CUSTOMER_APP_URL). */
export const CUSTOMER_APP_URL = (import.meta.env.VITE_CUSTOMER_APP_URL as string | undefined)?.trim() || null;

export function buildSlides(d: AdData): Slide[] {
  const slides: Slide[] = [];

  // Money first: nothing else matters if the seller cannot be paid. Only the
  // owner can set the number (§48), so only the owner is asked to.
  if (d.role === 'OWNER' && d.payoutStatus && d.payoutStatus !== 'VERIFIED' && d.payoutStatus !== 'SUPERSEDED') {
    slides.push({
      key: 'payout',
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

  // News: something that just happened, while it is still news.
  if (d.newOrder) {
    slides.push({
      key: 'news-order',
      look: 'green',
      icon: 'calendarCheck',
      eyebrow: `Just in · ${ago(d.newOrder.createdAt)}`,
      title: d.newOrder.subject ?? 'A new booking',
      // The notification's own body is an email's worth of words; a banner
      // says what it means and what happens next.
      text:
        d.newOrder.type === 'DEPOSIT_CONFIRMED'
          ? 'The deposit is paid. They read out their 6-digit code when they arrive — the sixth digit checks them in.'
          : 'A customer has booked. It shows under “Expected” as soon as their deposit is paid.',
      cta: { label: 'See your bookings', to: '/appointments' },
    });
  }
  const waiting = d.unreadThreads[0];
  if (waiting) {
    slides.push({
      key: 'news-message',
      look: 'coral',
      icon: 'message',
      eyebrow: `New message · ${waiting.lastMessageAt ? ago(waiting.lastMessageAt) : 'now'}`,
      title: `${waiting.customer.email} wrote to you`,
      text: `“${waiting.lastMessage?.preview ?? 'Sent a photo'}” — a shop cannot start a conversation, so a quick reply is the chance to win the booking.`,
      stat: d.unreadMessages > 1 ? { value: String(d.unreadMessages), label: 'unread' } : undefined,
      cta: { label: 'Reply', to: '/messages' },
    });
  }

  if (d.best) {
    slides.push({
      key: 'best',
      look: 'coral',
      icon: 'trendUp',
      eyebrow: 'Your best seller',
      title: d.best.name,
      text: d.best.onSale
        ? 'Your most booked service of the last 30 days — and it has a sale on.'
        : 'Your most booked service of the last 30 days. A short sale could bring in even more.',
      image: d.best.service?.images[0]?.url ?? null,
      stat: { value: String(d.best.count), label: d.best.count === 1 ? 'booking' : 'bookings' },
      cta: { label: d.best.onSale ? 'See your services' : 'Put it on sale', to: '/services' },
    });
  }

  const trend = d.trendingSame[0] ?? d.trendingEverywhere[0];
  if (trend) {
    const inKind = d.trendingSame[0] === trend && d.subcategoryName;
    slides.push({
      key: 'trending',
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

  if (d.missing.length > 0) {
    slides.push({
      key: 'health',
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
      look: 'gold',
      icon: 'star',
      eyebrow: 'Customers are waiting',
      title: `${d.unanswered} ${d.unanswered === 1 ? 'review is' : 'reviews are'} waiting for a reply`,
      text: 'Your reply sits under the review for everyone who reads it — the next customer reads both.',
      cta: { label: 'Reply now', to: '/reviews' },
    });
  }

  slides.push({
    key: 'buyer',
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
    look: 'green',
    icon: 'chart',
    eyebrow: 'How customers find you',
    title: 'Popular shops are shown first',
    text: 'The app ranks shops by their bookings, weighted by their rating. Good reviews and a full page move you up.',
    cta: { label: 'See how it is going', to: '/analytics' },
  });

  if (d.hasServices && !d.saleRunning) {
    slides.push({
      key: 'sale',
      look: 'coral',
      icon: 'percent',
      eyebrow: 'Idea',
      title: 'Run a sale this week',
      text: 'A service on sale shows its −% badge and the old price crossed out, and the app has a spotlight for deals.',
      cta: { label: 'Start a sale', to: '/services' },
    });
  }

  // How it works: the two rules sellers most often learn the hard way.
  for (const topic of guideTopics(d.feePercent).filter((t) => t.key === 'cancel' || t.key === 'photos')) {
    slides.push({
      key: `learn-${topic.key}`,
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
    look: 'night',
    icon: 'search',
    eyebrow: 'Tip',
    title: 'Jump to anything',
    text: `${SEARCH_HOW} and type any word — “prices”, “holiday”, “momo” — to go straight to the page you need.`,
  });

  return slides.slice(0, 11);
}
