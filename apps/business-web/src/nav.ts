import type { Access } from './access';
import type { IconName } from './ui/Icon';
import { t } from '@lingui/core/macro';

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
  /** Shown only to those who may use it (§277): the money, or how it is going. */
  need?: 'money' | 'insights';
};

/** `key` names the group for code (the welcome tour, §307); `group` is its heading, in the app's language (§308). */
export type NavGroup = { key: 'top' | 'shop' | 'customers' | 'money' | 'account'; group: string | null; items: NavItem[] };

export const SECTIONS: NavGroup[] = [
  {
    // Above the headings: the first things seen every morning (§131.1, §192).
    key: 'top',
    group: null,
    items: [
      {
        to: '/',
        get label() { return t`Overview`; },
        icon: 'overview',
        get keywords() { return t({ message: 'home today dashboard summary schedule next', context: 'search words' }); },
        get hint() { return t`Your day at a glance`; },
      },
      {
        to: '/appointments',
        get label() { return t`Appointments`; },
        icon: 'calendarCheck',
        get keywords() { return t({ message: 'bookings orders customers today check in verify code arrival redeem', context: 'search words' }); },
        get hint() { return t`Who is coming, and checking them in`; },
      },
    ],
  },
  {
    key: 'shop',
    get group() { return t`Your shop`; },
    items: [
      {
        to: '/profile',
        get label() { return t`Your shopfront`; },
        icon: 'store',
        get keywords() { return t({ message: 'profile logo cover photos gallery description pause', context: 'search words' }); },
        get hint() { return t`What customers see first`; },
      },
      {
        to: '/stories',
        get label() { return t`Stories`; },
        icon: 'stories',
        get keywords() { return t({ message: 'story photo today post 24 hours instagram status advert', context: 'search words' }); },
        get hint() { return t`A photo for today, at the top of the app`; },
      },
      {
        to: '/services',
        get label() { return t`Services`; },
        icon: 'tag',
        get keywords() { return t({ message: 'prices menu catalogue sale discount photos deposit', context: 'search words' }); },
        get hint() { return t`What you sell, and for how much`; },
      },
      {
        to: '/hours',
        get label() { return t`Branches & hours`; },
        icon: 'pin',
        get keywords() { return t({ message: 'locations opening times address map people served at once places capacity', context: 'search words' }); },
        get hint() { return t`Where you are and when you open`; },
      },
      {
        to: '/closures',
        get label() { return t`Closures & breaks`; },
        icon: 'calendarX',
        get keywords() { return t({ message: 'holiday closed lunch break block time off', context: 'search words' }); },
        get hint() { return t`Days off and blocked-out hours`; },
      },
    ],
  },
  {
    key: 'customers',
    get group() { return t`Customers`; },
    items: [
      {
        to: '/messages',
        get label() { return t`Messages`; },
        icon: 'message',
        get keywords() { return t({ message: 'chat inbox questions reply', context: 'search words' }); },
        get hint() { return t`Questions and replies`; },
      },
      {
        to: '/reviews',
        get label() { return t`Reviews`; },
        icon: 'star',
        get keywords() { return t({ message: 'ratings stars feedback reply', context: 'search words' }); },
        get hint() { return t`What customers said`; },
      },
      {
        to: '/followers',
        get label() { return t`Followers`; },
        icon: 'megaphone',
        get keywords() { return t({ message: 'followers offers message customers blast promotion marketing send', context: 'search words' }); },
        get hint() { return t`Write to customers who follow your shop`; },
      },
    ],
  },
  {
    key: 'money',
    get group() { return t`Money`; },
    items: [
      {
        to: '/getting-paid',
        get label() { return t`Getting paid`; },
        icon: 'wallet',
        get keywords() { return t({ message: 'payouts balance momo mobile money number', context: 'search words' }); },
        get hint() { return t`Your balance and payouts`; },
        need: 'money'
      },
      {
        to: '/analytics',
        get label() { return t`How it is going`; },
        icon: 'chart',
        get keywords() { return t({ message: 'analytics stats numbers reports busiest earnings', context: 'search words' }); },
        get hint() { return t`Bookings, money and ratings over time`; },
        need: 'insights'
      },
    ],
  },
  {
    key: 'account',
    get group() { return t`Manage account`; },
    items: [
      {
        to: '/people',
        get label() { return t`People`; },
        icon: 'users',
        get keywords() { return t({ message: 'staff team colleagues invite manager', context: 'search words' }); },
        get hint() { return t`Who works here with you`; },
      },
      {
        to: '/security',
        get label() { return t`Sign-in and security`; },
        icon: 'shield',
        get keywords() { return t({ message: 'sessions devices phones signed in sign out everywhere login security lost phone', context: 'search words' }); },
        get hint() { return t`Where you are signed in, and signing out there`; },
      },
      {
        to: '/notifications',
        get label() { return t`Notifications`; },
        icon: 'bell',
        get keywords() { return t({ message: 'alerts email push quiet hours settings summary unsubscribe', context: 'search words' }); },
        get hint() { return t`What we send you, and how`; },
      },
      {
        to: '/legal',
        get label() { return t`Legal`; },
        icon: 'legal',
        get keywords() { return t({ message: 'terms agreement privacy policy documents', context: 'search words' }); },
        get hint() { return t`The agreements you work under`; },
      },
      {
        to: '/help',
        get label() { return t`Help`; },
        icon: 'help',
        get keywords() { return t({ message: 'support ticket problem contact', context: 'search words' }); },
        get hint() { return t`Ask us anything`; },
      },
    ],
  },
];

/**
 * Every page with its group's heading — made when asked, never once at load:
 * the words are read in the app's language of the moment (§308).
 */
export const navItems = (): Array<NavItem & { group: string | null }> =>
  SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      to: item.to,
      label: item.label,
      icon: item.icon,
      keywords: item.keywords,
      hint: item.hint,
      need: item.need,
      group: section.group,
    })),
  );

const allowed = (item: NavItem, access: Access) => !item.need || access[item.need];

/** The pages this person may use (§277), with any heading left empty dropped. */
export const sectionsFor = (access: Access): NavGroup[] =>
  SECTIONS.map((section) => ({ key: section.key, group: section.group, items: section.items.filter((item) => allowed(item, access)) })).filter(
    (section) => section.items.length > 0,
  );

export const navItemsFor = (access: Access) => navItems().filter((item) => allowed(item, access));

/** The page an address belongs to, for the top bar's title. */
export const navItemFor = (pathname: string) =>
  navItems().find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)) ?? null;
