import type { IconName } from '../ui/Icon';
import { t } from '@lingui/core/macro';

/**
 * "How it works" — the rules a seller lives by, in plain words (§205).
 *
 * Every sentence here is taken from what the platform actually does, with the
 * section of DECISIONS.md it comes from beside it, so a rule that changes has
 * one obvious place whose words must change with it. The platform's fee is
 * read from the seller's own latest booking rather than written here.
 */
export type GuideTopic = {
  key: string;
  icon: IconName;
  tone: 'coral' | 'green' | 'blue' | 'amber' | 'violet' | 'red' | 'night' | 'gold';
  title: string;
  /** One line, for the chip and the banner. */
  short: string;
  points: string[];
  link?: { label: string; to: string };
};

export function guideTopics(feePercent: string | null): GuideTopic[] {
  const fee = feePercent ? `${feePercent}%` : t`a percentage`;
  return [
    {
      // §2, §16.3, §25, §40
      key: 'deposits',
      icon: 'wallet',
      tone: 'green',
      title: t`Deposits and fees`,
      short: t`Customers pay a deposit to hold their time; the rest is paid to you at the shop.`,
      points: [
        t`When a customer books, they pay a deposit from their phone — the percentage you set on each service.`,
        t`The platform’s fee (${fee} of the price) comes out of that deposit. What is left of the deposit is your share, paid out to you.`,
        t`The rest of the price is paid to you directly at the shop — it never passes through the app.`,
        t`A deposit percentage cannot be lower than the fee, so your share is never negative.`,
      ],
      link: { label: t`Set deposits on Services`, to: '/services' },
    },
    {
      // §25, §33, §36
      key: 'cancel',
      icon: 'calendarX',
      tone: 'red',
      title: t`Cancellations and refunds`,
      short: t`If the customer cancels, the deposit stays. If you cancel, they get it all back.`,
      points: [
        t`A customer who cancels does not get their deposit back — that is what a deposit is for — and your share of it is still paid to you.`,
        t`If you cancel, the customer gets the whole deposit back, the platform’s fee included, and the mobile money charge for sending it back is yours.`,
        t`You must give a reason when you cancel. The customer is told it.`,
        t`Only a booking that has not started can be cancelled — not one you have checked in.`,
      ],
      link: { label: t`See your bookings`, to: '/appointments' },
    },
    {
      // §16.2, §20 (auto-transition), §25
      key: 'noshow',
      icon: 'userX',
      tone: 'amber',
      title: t`When a customer does not come`,
      short: t`Mark them as a no-show: the deposit is not refunded.`,
      points: [
        t`Press “No-show” on the booking. The deposit is not refunded, the customer is told, and your share of it is paid to you.`,
        t`If you forget, a booking nobody checked in becomes a no-show by itself 24 hours after its end.`,
        t`A booking you checked in but never marked done becomes “Done” by itself, 24 hours after its end.`,
      ],
      link: { label: t`See your bookings`, to: '/appointments' },
    },
    {
      // §17.4
      key: 'unpaid',
      icon: 'hourglass',
      tone: 'night',
      title: t`Bookings waiting for payment`,
      short: t`An unpaid booking holds the time for 5 minutes, then lets it go.`,
      points: [
        t`A new booking holds its time while the customer approves the deposit on their phone.`,
        t`If they have not paid within 5 minutes, it is cancelled by itself and the time is free again.`,
        t`Only paid bookings appear under “Expected”.`,
      ],
    },
    {
      // §16.2, §54.3, §191
      key: 'checkin',
      icon: 'ticket',
      tone: 'coral',
      title: t`Checking customers in`,
      short: t`Every booking has a 6-digit code. The sixth digit checks them in.`,
      points: [
        t`Each booking has a 6-digit code — emailed to the customer and shown in their app. Ask for it when they arrive.`,
        t`After 5 wrong tries the code is locked.`,
        t`An owner or manager can check someone in without the code by writing what the customer recalled. It is recorded against their name, and every administrator is told.`,
      ],
      link: { label: t`Check someone in`, to: '/appointments' },
    },
    {
      // §186, §140
      key: 'sales',
      icon: 'percent',
      tone: 'violet',
      title: t`Discounts`,
      short: t`1–90% off, until a day you choose or until you end it.`,
      points: [
        t`Give any service a discount from 1% to 90% off, at every branch at once.`,
        t`Choose a last day (the whole day counts) or leave it to run until you end it.`,
        t`Customers see a −% badge and the old price crossed out. The deposit is worked out on the discounted price.`,
        t`Bookings already made keep the price they were made at.`,
        t`Customers who asked for it get a Friday email of services near them, with discounts shown at their discounted price.`,
      ],
      link: { label: t`Start a discount`, to: '/services' },
    },
    {
      // §132, §165, §187, storage limits
      key: 'photos',
      icon: 'camera',
      tone: 'blue',
      title: t`Photos that get booked`,
      short: t`The first photo is the cover customers scroll past. Make it your best.`,
      points: [
        t`Up to 11 photos per service and 30 per branch — JPEG, PNG or WebP, up to 15 MB each.`,
        t`The cover is the photo on the service’s card in the app. Choose it with “Make cover”.`,
        t`Show the real result, in daylight or good light, sharp and filling the frame — and no writing over the picture.`,
        t`Photograph the place too: customers want to see where they are walking into.`,
      ],
      link: { label: t`Add photos`, to: '/services' },
    },
    {
      // §46, §48, §77
      key: 'payouts',
      icon: 'banknote',
      tone: 'green',
      title: t`Getting paid`,
      short: t`Your share waits a short while after each visit, then goes to your mobile money.`,
      points: [
        t`Your share of a deposit becomes yours when the booking is done, marked a no-show, or cancelled by the customer.`,
        t`It waits a couple of days after the visit, then goes out in that night’s payment to your mobile money number.`,
        t`Payments need a confirmed number. Changing it pauses them until our team confirms the new one — nothing you earned is lost.`,
      ],
      link: { label: t`See your money`, to: '/getting-paid' },
    },
    {
      // §92, §135.1
      key: 'reviews',
      icon: 'star',
      tone: 'gold',
      title: t`Reviews and ranking`,
      short: t`Only customers who came can review. Good ratings move you up.`,
      points: [
        t`Only a customer whose booking is done can review it.`,
        t`You get one reply per review, and can edit it for 7 days. Both are public.`,
        t`The app shows popular shops first: bookings, weighted by rating.`,
      ],
      link: { label: t`Reply to reviews`, to: '/reviews' },
    },
    {
      // §72, §104, §43, §12, §206
      key: 'grow',
      icon: 'store',
      tone: 'green',
      title: t`More than one shop`,
      short: t`Have shops in different places? Add each one as a branch.`,
      points: [
        t`Another shop in another street, district or town? Add it on Branches & hours with “Add a branch”. An owner or a manager can.`,
        t`Each branch has its own address and map pin, opening hours, photos, closures and breaks, and how many people it serves at once.`,
        t`Customers see each branch on its own: people nearby find the one closest to them, and each branch collects its own reviews and rating.`,
        t`Your services are shared. On Services, choose which branches offer each one, at each branch’s own price.`,
        t`A new branch starts closed and offers nothing. Set its hours and choose its services, and customers can book it.`,
        t`One team, one payout number and one money page cover every branch.`,
      ],
      link: { label: t`Add a branch`, to: '/hours?add=1' },
    },
    {
      // §16.4, §189, §89, §119
      key: 'branches',
      icon: 'pin',
      tone: 'night',
      title: t`Places, pausing and closing`,
      short: t`“People served at once” decides how many can book the same time.`,
      points: [
        t`Each branch says how many people it serves at once. A booking for 3 takes 3 places; when every place is taken, the time shows as booked.`,
        t`Pausing the shop hides every branch and stops new bookings. Bookings you already have still happen.`,
        t`A branch cannot be closed while it still has bookings to come.`,
      ],
      link: { label: t`Branches & hours`, to: '/hours' },
    },
    {
      // §21, §112
      key: 'messages',
      icon: 'message',
      tone: 'coral',
      title: t`Messages`,
      short: t`Customers can write before they book and about a booking.`,
      points: [
        t`A customer can message you before booking, and about any booking they have made.`,
        t`Everyone on your team can reply; each reply shows who wrote it to your team, never to the customer.`,
        t`A shop cannot start a conversation — so a quick reply is the one chance to win the booking.`,
      ],
      link: { label: t`Open messages`, to: '/messages' },
    },
  ];
}
