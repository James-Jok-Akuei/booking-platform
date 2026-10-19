import type { IconName } from './ui/Icon';

/**
 * Every page of the admin console, in one list (§131, §242).
 *
 * The sidebar, the phone's menu, the top bar's title and the ⌘K search all
 * read this, so a page is added, renamed or moved in one place and every way
 * of reaching it follows. The twelve addresses are the ones §131 promised
 * would not change; only how they are shown has.
 */
export type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  /** Other words someone might type into the search to find this page. */
  keywords: string;
  /** Said under the label in the search, so a page is found by what it is FOR. */
  hint: string;
  /** Which "waiting" count, if any, this page's badge shows (§242). */
  badge?: 'businesses' | 'destinations' | 'payouts' | 'tickets' | 'stories';
};

export type NavGroup = { group: string | null; items: NavItem[] };

export const SECTIONS: NavGroup[] = [
  {
    // Above the headings: the first thing seen every morning (§243).
    group: null,
    items: [
      {
        to: '/',
        label: 'Overview',
        icon: 'overview',
        keywords: 'home dashboard today waiting queue summary pulse week',
        hint: 'What needs you, and how the platform is doing',
      },
    ],
  },
  {
    // Deciding what stays on the platform.
    group: 'Moderation',
    items: [
      {
        to: '/businesses',
        label: 'Businesses',
        icon: 'store',
        keywords: 'approve approval queue shops applications reject suspend reinstate sellers',
        hint: 'Shops waiting for approval, and every shop',
        badge: 'businesses',
      },
      {
        to: '/reviews',
        label: 'Reviews',
        icon: 'star',
        keywords: 'moderation hide unhide ratings comments abuse',
        hint: 'Hide a review that breaks the rules',
      },
      {
        to: '/stories',
        label: 'Stories',
        icon: 'stories',
        keywords: 'story photo reported report take down remove 24 hours instagram status',
        hint: 'Take down a story customers reported',
        badge: 'stories',
      },
      {
        to: '/appointments',
        label: 'Appointments',
        icon: 'calendarCheck',
        keywords: 'bookings cancellations disputes reclassify refund',
        hint: 'Every booking, and settling a dispute',
      },
    ],
  },
  {
    group: 'People',
    items: [
      {
        to: '/users',
        label: 'Users',
        icon: 'users',
        keywords: 'customers accounts directory admins invite display name',
        hint: 'Find anyone, and invite administrators',
      },
      {
        to: '/tickets',
        label: 'Support',
        icon: 'help',
        keywords: 'tickets help requests complaints reply assign',
        hint: 'Questions and problems from customers and shops',
        badge: 'tickets',
      },
      {
        to: '/announcements',
        label: 'Announcements',
        icon: 'megaphone',
        keywords: 'announce broadcast message everyone customers sellers notice email push banner news offers',
        hint: 'Write to many people at once',
      },
    ],
  },
  {
    // The three that have to be read together to answer "did the money move".
    group: 'Money',
    items: [
      {
        to: '/payouts',
        label: 'Payouts',
        icon: 'send',
        keywords: 'pay businesses run send transfer mark paid failed',
        hint: 'Money owed to shops, and sending it',
        badge: 'payouts',
      },
      {
        to: '/payout-destinations',
        label: 'Payout numbers',
        icon: 'wallet',
        keywords: 'payout destinations momo mtn airtel verify numbers check',
        hint: 'Checking the numbers shops are paid to',
        badge: 'destinations',
      },
      {
        to: '/ledger',
        label: 'Money',
        icon: 'banknote',
        keywords: 'ledger entries reconciliation adjustments fees deposits held balance',
        hint: 'Every franc in and out, and the wallet check',
      },
    ],
  },
  {
    // Reference data and rules. Rarely touched, and dangerous when it is.
    group: 'Platform',
    items: [
      {
        to: '/categories',
        label: 'Categories',
        icon: 'layers',
        keywords: 'taxonomy subcategories kinds types of business',
        hint: 'What kinds of business can sign up',
      },
      {
        to: '/places',
        label: 'Places',
        icon: 'pin',
        keywords: 'districts provinces where open locations regions',
        hint: 'Where the platform is open for business',
      },
      {
        to: '/legal',
        label: 'Legal',
        icon: 'legal',
        keywords: 'terms privacy seller agreement documents publish versions',
        hint: 'The documents everyone agrees to',
      },
      {
        to: '/notifications',
        label: 'Notifications',
        icon: 'bell',
        keywords: 'alerts email settings what we send',
        hint: 'What you are sent, and how',
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: 'sliders',
        keywords: 'platform fee exchange rate payout hold configuration',
        hint: 'The platform fee, exchange rate and payout hold',
      },
    ],
  },
];

export const NAV_ITEMS: Array<NavItem & { group: string | null }> = SECTIONS.flatMap((section) =>
  section.items.map((item) => ({ ...item, group: section.group })),
);

/** The page an address belongs to, for the top bar's title. */
export const navItemFor = (pathname: string) =>
  NAV_ITEMS.find((item) => pathname === item.to || (item.to !== '/' && pathname.startsWith(`${item.to}/`))) ?? null;
