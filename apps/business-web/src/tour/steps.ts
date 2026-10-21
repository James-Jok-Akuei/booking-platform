import type { Access } from '../access';
import type { IconName } from '../ui/Icon';

/**
 * What the welcome tour says (§307), in two parts.
 *
 * The FILM is how a booking reaches a seller, from a customer's phone to their
 * mobile money — each scene the real screen of that moment, captured from the
 * apps themselves (`public/tour/`), the way the landing page shows its steps
 * (§260). The MARKS then light the real parts of this app, one at a time.
 *
 * Every sentence is the platform's real rule, as `ads/guide.ts` words them —
 * when a rule changes, these words change with it.
 */

/** Where on a screenshot the eye should go: a box, in percent of the picture. */
export type Spot = { x: number; y: number; w: number; h: number };

export type Scene = {
  key: 'find' | 'book' | 'booked' | 'checkin' | 'paid';
  /** Whose screen it is: the customer's phone, or this app. */
  side: 'customer' | 'seller';
  title: string;
  text: string;
  alt: string;
  chip: { icon: IconName; tone: 'orange' | 'night' | 'green'; title: string; text: string };
  /** The part of the computer screenshot, and of the phone one, the scene is about. A customer's screen has only a phone one. */
  desk?: Spot;
  phone: Spot;
};

export const SCENES: Scene[] = [
  {
    key: 'find',
    side: 'customer',
    title: 'A customer finds you',
    text: 'In the app, near them — by what you sell, with your photos, prices and reviews.',
    alt: 'A shop’s page in the customer app: its photos, rating and services.',
    chip: { icon: 'search', tone: 'night', title: 'Found nearby', text: 'People close to you see you first' },
    phone: { x: 3, y: 34, w: 94, h: 22 },
  },
  {
    key: 'book',
    side: 'customer',
    title: 'They book a time and pay a deposit',
    text: 'A small part of the price, from their phone by mobile money. The rest they pay you at the shop.',
    alt: 'The customer app’s checkout: the time chosen and the deposit paid by mobile money.',
    chip: { icon: 'wallet', tone: 'green', title: 'Deposit paid', text: 'The time is truly theirs' },
    phone: { x: 6, y: 22, w: 88, h: 8.5 },
  },
  {
    key: 'booked',
    side: 'seller',
    title: 'It lands in your bookings',
    text: 'The time, the service and their answers — here, the moment it is paid.',
    alt: 'The business app’s bookings: who is coming, when, and for what.',
    chip: { icon: 'calendarCheck', tone: 'orange', title: 'New booking', text: 'We let you know straight away' },
    desk: { x: 21.5, y: 53, w: 53.5, h: 31 },
    phone: { x: 4, y: 19.5, w: 92, h: 27.5 },
  },
  {
    key: 'checkin',
    side: 'seller',
    title: 'They show a code — you check them in',
    text: 'Every booking has a 6-digit code. Type it in Check in when they arrive; the sixth digit does it.',
    alt: 'The business app’s Check in: six boxes for the customer’s code.',
    chip: { icon: 'ticket', tone: 'orange', title: 'Checked in', text: 'Six digits, and they are in' },
    desk: { x: 34, y: 44, w: 32, h: 19 },
    phone: { x: 6, y: 60, w: 88, h: 20 },
  },
  {
    key: 'paid',
    side: 'seller',
    title: 'Your share comes to your mobile money',
    text: 'What is left of the deposit after our fee is sent to your MoMo number a couple of days after the visit.',
    alt: 'The business app’s Getting paid: the balance and each payout to mobile money.',
    chip: { icon: 'banknote', tone: 'green', title: 'Paid out', text: 'To your MoMo number' },
    desk: { x: 21.3, y: 23, w: 26.4, h: 42.5 },
    phone: { x: 3.5, y: 28.5, w: 93, h: 33.5 },
  },
];

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export type Mark = {
  /** The `data-tour` name of what is lit. */
  target: string;
  title: string;
  text: string;
  icon: IconName;
  place: Placement;
  /** The corners of the light, to match what it lights. */
  radius?: number;
  /** Space between what is lit and the edge of the light. */
  pad?: number;
  /** Shown only to those who may use it (§277). */
  need?: 'money';
};

/** On a computer or a tablet: the menu down the left, and the bar along the top. */
const WIDE: Mark[] = [
  {
    target: 'go-live',
    title: 'Getting your shop live',
    text: 'This card shows what is left. Finish it and send your shop for review — we check it, usually within a working day — then you post it, and customers can book.',
    icon: 'send',
    place: 'bottom',
    radius: 26,
  },
  {
    target: 'today',
    title: 'Your day at a glance',
    text: 'Who is coming today, what you have earned, and what needs you. This page opens every morning.',
    icon: 'overview',
    place: 'bottom',
    radius: 24,
  },
  {
    target: 'check-in',
    title: 'When a customer arrives',
    text: 'They show you their 6-digit code. Press Check in and type it — that tells us they came.',
    icon: 'ticket',
    place: 'bottom',
    radius: 16,
  },
  {
    target: 'page:/appointments',
    title: 'Every booking',
    text: 'Coming up and past, as a list or a calendar. Open one to see what they chose and answered, or to mark a no-show.',
    icon: 'calendarCheck',
    place: 'right',
    radius: 12,
  },
  {
    target: 'group:shop',
    title: 'Your shop',
    text: 'What customers see: your shopfront, the services you sell, where you are and when you open, and a photo story for today.',
    icon: 'store',
    place: 'right',
    radius: 16,
  },
  {
    target: 'group:customers',
    title: 'Talking to customers',
    text: 'Their questions and your replies, what they said in reviews, and news for the people who follow your shop.',
    icon: 'message',
    place: 'right',
    radius: 16,
  },
  {
    target: 'group:money',
    title: 'Your money',
    text: 'Your balance, every payout to your mobile money, and how the month is going.',
    icon: 'wallet',
    place: 'right',
    radius: 16,
    need: 'money',
  },
  {
    target: 'search',
    title: 'Find anything fast',
    text: 'Press / or ⌘K and type a word — “prices”, “momo”, “holiday” — to jump to the page for it.',
    icon: 'search',
    place: 'bottom',
    radius: 14,
  },
  {
    target: 'page:/help',
    title: 'We are here to help',
    text: 'Ask us anything, any time. This tour is in Help too, whenever you want it again.',
    icon: 'help',
    place: 'right',
    radius: 12,
  },
];

/** On a phone: the bar along the bottom, with everything else under Menu. */
const PHONE: Mark[] = [
  WIDE[0],
  { ...WIDE[1], place: 'bottom' },
  {
    target: 'check-in',
    title: 'When a customer arrives',
    text: 'They show you their 6-digit code. Press here and type it — that tells us they came.',
    icon: 'ticket',
    place: 'top',
    radius: 999,
    pad: 4,
  },
  {
    target: 'tab:/appointments',
    title: 'Every booking',
    text: 'Coming up and past. Open one to see what they chose and answered, or to mark a no-show.',
    icon: 'calendarCheck',
    place: 'top',
    radius: 18,
    pad: 2,
  },
  {
    target: 'tab:/messages',
    title: 'Talking to customers',
    text: 'Customers can write before they book and about a booking. A quick reply often wins it.',
    icon: 'message',
    place: 'top',
    radius: 18,
    pad: 2,
  },
  {
    target: 'menu',
    title: 'Everything else',
    text: 'Your shopfront, services, hours, money, people and Help are all under Menu. This tour is in Help, whenever you want it again.',
    icon: 'menu',
    place: 'top',
    radius: 18,
    pad: 2,
  },
];

export const marksFor = (phone: boolean, access: Access): Mark[] =>
  (phone ? PHONE : WIDE).filter((mark) => !mark.need || access[mark.need]);

/** After "I'll look around myself": where the tour is kept. */
export const keptMark = (phone: boolean): Mark =>
  phone
    ? { ...PHONE[PHONE.length - 1], title: 'The tour is kept for you', text: 'Whenever you want it, it is in Help, under Menu.' }
    : { ...WIDE[WIDE.length - 1], title: 'The tour is kept for you', text: 'Whenever you want it, it is here in Help.' };
