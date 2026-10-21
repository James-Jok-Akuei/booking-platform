import type { Access } from '../access';
import type { IconName } from '../ui/Icon';
import { t } from '@lingui/core/macro';

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
    get title() { return t`A customer finds you`; },
    get text() { return t`In the app, near them — by what you sell, with your photos, prices and reviews.`; },
    get alt() { return t`A shop’s page in the customer app: its photos, rating and services.`; },
    chip: {
      icon: 'search',
      tone: 'night',
      get title() { return t`Found nearby`; },
      get text() { return t`People close to you see you first`; },
    },

    phone: { x: 3, y: 34, w: 94, h: 22 }
  },
  {
    key: 'book',
    side: 'customer',
    get title() { return t`They book a time and pay a deposit`; },
    get text() { return t`A small part of the price, from their phone by mobile money. The rest they pay you at the shop.`; },
    get alt() { return t`The customer app’s checkout: the time chosen and the deposit paid by mobile money.`; },
    chip: {
      icon: 'wallet',
      tone: 'green',
      get title() { return t`Deposit paid`; },
      get text() { return t`The time is truly theirs`; },
    },

    phone: { x: 6, y: 22, w: 88, h: 8.5 }
  },
  {
    key: 'booked',
    side: 'seller',
    get title() { return t`It lands in your bookings`; },
    get text() { return t`The time, the service and their answers — here, the moment it is paid.`; },
    get alt() { return t`The business app’s bookings: who is coming, when, and for what.`; },
    chip: {
      icon: 'calendarCheck',
      tone: 'orange',
      get title() { return t`New booking`; },
      get text() { return t`We let you know straight away`; },
    },

    desk: { x: 21.5, y: 53, w: 53.5, h: 31 },
    phone: { x: 4, y: 19.5, w: 92, h: 27.5 }
  },
  {
    key: 'checkin',
    side: 'seller',
    get title() { return t`They show a code — you check them in`; },
    get text() { return t`Every booking has a 6-digit code. Type it in Check in when they arrive; the sixth digit does it.`; },
    get alt() { return t`The business app’s Check in: six boxes for the customer’s code.`; },
    chip: {
      icon: 'ticket',
      tone: 'orange',
      get title() { return t`Checked in`; },
      get text() { return t`Six digits, and they are in`; },
    },

    desk: { x: 34, y: 44, w: 32, h: 19 },
    phone: { x: 6, y: 60, w: 88, h: 20 }
  },
  {
    key: 'paid',
    side: 'seller',
    get title() { return t`Your share comes to your mobile money`; },
    get text() { return t`What is left of the deposit after our fee is sent to your MoMo number a couple of days after the visit.`; },
    get alt() { return t`The business app’s Getting paid: the balance and each payout to mobile money.`; },
    chip: {
      icon: 'banknote',
      tone: 'green',
      get title() { return t`Paid out`; },
      get text() { return t`To your MoMo number`; },
    },

    desk: { x: 21.3, y: 23, w: 26.4, h: 42.5 },
    phone: { x: 3.5, y: 28.5, w: 93, h: 33.5 }
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
    get title() { return t`Getting your shop live`; },
    get text() { return t`This card shows what is left. Finish it and send your shop for review — we check it, usually within a working day — then you post it, and customers can book.`; },
    icon: 'send',
    place: 'bottom',
    radius: 26
  },
  {
    target: 'today',
    get title() { return t`Your day at a glance`; },
    get text() { return t`Who is coming today, what you have earned, and what needs you. This page opens every morning.`; },
    icon: 'overview',
    place: 'bottom',
    radius: 24
  },
  {
    target: 'check-in',
    get title() { return t`When a customer arrives`; },
    get text() { return t`They show you their 6-digit code. Press Check in and type it — that tells us they came.`; },
    icon: 'ticket',
    place: 'bottom',
    radius: 16
  },
  {
    target: 'page:/appointments',
    get title() { return t`Every booking`; },
    get text() { return t`Coming up and past, as a list or a calendar. Open one to see what they chose and answered, or to mark a no-show.`; },
    icon: 'calendarCheck',
    place: 'right',
    radius: 12
  },
  {
    target: 'group:shop',
    get title() { return t`Your shop`; },
    get text() { return t`What customers see: your shopfront, the services you sell, where you are and when you open, and a photo story for today.`; },
    icon: 'store',
    place: 'right',
    radius: 16
  },
  {
    target: 'group:customers',
    get title() { return t`Talking to customers`; },
    get text() { return t`Their questions and your replies, what they said in reviews, and news for the people who follow your shop.`; },
    icon: 'message',
    place: 'right',
    radius: 16
  },
  {
    target: 'group:money',
    get title() { return t`Your money`; },
    get text() { return t`Your balance, every payout to your mobile money, and how the month is going.`; },
    icon: 'wallet',
    place: 'right',
    radius: 16,
    need: 'money'
  },
  {
    target: 'search',
    get title() { return t`Find anything fast`; },
    get text() { return t`Press / or ⌘K and type a word — “prices”, “momo”, “holiday” — to jump to the page for it.`; },
    icon: 'search',
    place: 'bottom',
    radius: 14
  },
  {
    target: 'page:/help',
    get title() { return t`We are here to help`; },
    get text() { return t`Ask us anything, any time. This tour is in Help too, whenever you want it again.`; },
    icon: 'help',
    place: 'right',
    radius: 12
  },
];

/**
 * A mark like another with a few changes — its words still read when shown
 * (§308): a spread here would copy them once, at load, in English.
 */
const like = (mark: Mark, changes: Partial<Mark>): Mark => Object.assign(Object.create(mark) as Mark, changes);

/** On a phone: the bar along the bottom, with everything else under Menu. */
const PHONE: Mark[] = [
  WIDE[0],
  like(WIDE[1], { place: 'bottom' }),
  {
    target: 'check-in',
    get title() { return t`When a customer arrives`; },
    get text() { return t`They show you their 6-digit code. Press here and type it — that tells us they came.`; },
    icon: 'ticket',
    place: 'top',
    radius: 999,
    pad: 4
  },
  {
    target: 'tab:/appointments',
    get title() { return t`Every booking`; },
    get text() { return t`Coming up and past. Open one to see what they chose and answered, or to mark a no-show.`; },
    icon: 'calendarCheck',
    place: 'top',
    radius: 18,
    pad: 2
  },
  {
    target: 'tab:/messages',
    get title() { return t`Talking to customers`; },
    get text() { return t`Customers can write before they book and about a booking. A quick reply often wins it.`; },
    icon: 'message',
    place: 'top',
    radius: 18,
    pad: 2
  },
  {
    target: 'menu',
    get title() { return t`Everything else`; },
    get text() { return t`Your shopfront, services, hours, money, people and Help are all under Menu. This tour is in Help, whenever you want it again.`; },
    icon: 'menu',
    place: 'top',
    radius: 18,
    pad: 2
  },
];

export const marksFor = (phone: boolean, access: Access): Mark[] =>
  (phone ? PHONE : WIDE).filter((mark) => !mark.need || access[mark.need]);

/** After "I'll look around myself": where the tour is kept. */
export const keptMark = (phone: boolean): Mark =>
  phone
    ? { ...PHONE[PHONE.length - 1], title: t`The tour is kept for you`, text: t`Whenever you want it, it is in Help, under Menu.` }
    : { ...WIDE[WIDE.length - 1], title: t`The tour is kept for you`, text: t`Whenever you want it, it is here in Help.` };
