import type { IconName } from './ui/Icon';

/**
 * Every page of the business app, in one list (§131, §190).
 *
 * The sidebar, the phone's menu, the top bar's title and the ⌘K search all read
 * this, so a page is added, renamed or moved in one place and every way of
 * reaching it follows. The addresses are the ones §131 promised would not
 * change; only how they are shown has.
 */
export type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  /** Other words someone might type into the search to find this page. */
  keywords: string;
  /** Said under the label in the search, so a page is found by what it is FOR. */
  hint: string;
};

export type NavGroup = { group: string | null; items: NavItem[] };

export const SECTIONS: NavGroup[] = [
  {
    // Above the headings: the first thing seen every morning (§131.1).
    group: null,
    items: [
      {
        to: '/appointments',
        label: 'Appointments',
        icon: 'calendarCheck',
        keywords: 'bookings orders customers today check in verify code arrival redeem',
        hint: 'Who is coming, and checking them in',
      },
    ],
  },
  {
    group: 'Your shop',
    items: [
      {
        to: '/profile',
        label: 'Your shopfront',
        icon: 'store',
        keywords: 'profile logo cover photos gallery description pause',
        hint: 'What customers see first',
      },
      {
        to: '/services',
        label: 'Services',
        icon: 'tag',
        keywords: 'prices menu catalogue sale discount photos deposit',
        hint: 'What you sell, and for how much',
      },
      {
        to: '/hours',
        label: 'Branches & hours',
        icon: 'pin',
        keywords: 'locations opening times address map people served at once places capacity',
        hint: 'Where you are and when you open',
      },
      {
        to: '/closures',
        label: 'Closures & breaks',
        icon: 'calendarX',
        keywords: 'holiday closed lunch break block time off',
        hint: 'Days off and blocked-out hours',
      },
    ],
  },
  {
    group: 'Customers',
    items: [
      {
        to: '/messages',
        label: 'Messages',
        icon: 'message',
        keywords: 'chat inbox questions reply',
        hint: 'Questions and replies',
      },
      {
        to: '/reviews',
        label: 'Reviews',
        icon: 'star',
        keywords: 'ratings stars feedback reply',
        hint: 'What customers said',
      },
    ],
  },
  {
    group: 'Money',
    items: [
      {
        to: '/getting-paid',
        label: 'Getting paid',
        icon: 'wallet',
        keywords: 'payouts balance momo mobile money number',
        hint: 'Your balance and payouts',
      },
      {
        to: '/analytics',
        label: 'How it is going',
        icon: 'chart',
        keywords: 'analytics stats numbers reports busiest earnings',
        hint: 'Bookings, money and ratings over time',
      },
    ],
  },
  {
    group: 'Manage account',
    items: [
      {
        to: '/people',
        label: 'People',
        icon: 'users',
        keywords: 'staff team colleagues invite manager',
        hint: 'Who works here with you',
      },
      {
        to: '/legal',
        label: 'Legal',
        icon: 'legal',
        keywords: 'terms agreement privacy policy documents',
        hint: 'The agreements you work under',
      },
      {
        to: '/help',
        label: 'Help',
        icon: 'help',
        keywords: 'support ticket problem contact',
        hint: 'Ask us anything',
      },
    ],
  },
];

export const NAV_ITEMS: Array<NavItem & { group: string | null }> = SECTIONS.flatMap((section) =>
  section.items.map((item) => ({ ...item, group: section.group })),
);

/** The page an address belongs to, for the top bar's title. */
export const navItemFor = (pathname: string) =>
  NAV_ITEMS.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)) ?? null;
