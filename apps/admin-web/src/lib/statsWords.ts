/**
 * What every number on the statistics page counts (§316), in one place, so
 * the ⓘ beside a number, the download and the pitch sheet all say the same.
 *
 * Written for someone reading the number cold — a teammate, or an investor
 * looking at the pitch sheet — so each one says what is in it AND what is
 * not. The server's rules behind them are in `admin-statistics.service.ts`.
 */
export const MEANING = {
  made:
    'Platform fees kept since the first booking: every fee taken, less every fee handed back — when a shop cancelled, or by a fee refund. Before any of our own costs.',
  bookings:
    'Bookings whose deposit was paid, counted on the day it was paid on the shop’s own clock. A booking that was started and never paid is not counted.',
  bookingValue:
    'The full agreed price of the bookings paid for — the deposit plus what is paid at the shop, choices and sale prices included. Cancelled bookings count for nothing.',
  doneValue: 'The full price of the bookings that have already taken place.',
  deposits: 'Every deposit paid through the app, including ones later refunded.',
  feesKept:
    'Platform fees taken, less fees handed back, each on the day it was written in the money book. The same rule as “made by the platform”.',
  averageBooking: 'Booking value divided by the bookings that were not cancelled.',
  averageDeposit: 'Deposits divided by the bookings paid for.',
  newCustomers: 'Customer accounts opened. Customers belong to no country or category, so this is always the whole platform.',
  customersBooked: 'Different customers who paid for at least one booking.',
  shopsWentLive: 'Shops that posted themselves for customers to find, after our team approved them.',
  customers: 'Customer accounts open today — the whole platform, whatever is chosen above.',
  customersWhoBooked: 'Customers who have ever paid for a booking.',
  cameBack: 'Of the customers who have booked, those who booked twice or more.',
  liveShops: 'Approved, posted by the shop, and not paused: what customers can find today.',
  areas: 'Districts with at least one open branch of a live shop.',
  rating: 'The average of every review customers can see. Hidden reviews are left out.',
  outcomes: 'What became of the bookings paid for in this time.',
  started: 'Of the bookings started in this time, how many were paid for. The rest were left at the payment step.',
  leadTime: 'How long before the visit people paid: the visit’s day against the day the deposit was paid.',
  heat: 'When booked visits take place, on each shop’s clock. Cancelled ones are left out.',
  refunds: 'Deposits that reached the customer’s phone again.',
  payouts: 'Money that reached shops. A payout covers a whole shop, so choosing an area does not narrow it.',
  firstTime: 'Of the customers who booked in this time: first booking ever, or back after an earlier one.',
  bookingsPerCustomer: 'Bookings paid for, divided by the customers who paid for them.',
  joinedAndBooked: 'Of the accounts opened in this time, how many have paid for a booking since.',
  follows: 'Times a customer followed a shop.',
  applied: 'Shops that sent themselves for review in this time (the last time each one did).',
  withBookings: 'Shops with at least one booking paid for in this time.',
  daysToLive: 'For the shops that went live in this time: the middle number of days from signing up to going live.',
  topShops: 'The shops with the most bookings, or the most booking value, in this time. Inside the console only — never on the pitch sheet.',
  byCategory: 'Bookings by each shop’s main category, beside the live shops in it today.',
  byDistrict: 'Bookings by the district of the branch they were made at, beside the live shops there today.',
  services: 'Services booked most, grouped by name across shops.',
  searches:
    'What customers typed into search. A search that found nothing is something customers want that the platform does not have yet.',
  reviews: 'Reviews written in this time that customers can see.',
  months: 'Each month on the shop’s clock. Value and fees by the same rules as above.',
  cohorts:
    'Customers grouped by the month of their first booking, and how many of them booked again one, two, three months later.',
  leftOut:
    'Our own test shops and customers, and the demo’s. They and everything they did are left out of every number here. The money pages still count every franc.',
  check:
    'For the same bookings, the deposits and fees the bookings recorded against what the money book wrote for them. They should always match.',
} as const;

export type MeaningKey = keyof typeof MEANING;

/** Who last marked a shop or a person as a test one, and when (§316). */
export const markedWords = (who: string | null, at: string | null) =>
  `${who === 'automatic' ? 'Marked automatically' : who ? `Marked by ${who}` : 'Marked'}${
    at ? `, ${new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''
  }.`;
