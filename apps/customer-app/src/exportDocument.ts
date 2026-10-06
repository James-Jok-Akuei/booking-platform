import type { AccountExport } from './api/auth';
import { BOOKING_STATUS } from './bookingStatus';
import { TICKET_STATUS } from './ticketStatus';

/**
 * A person's data, as a document a person can read (§144).
 *
 * The export was a JSON file: complete, and to most people who asked for "a
 * copy of my data" indistinguishable from an error. This sets the same data out
 * as pages — who you are, what you booked, what you wrote, what was said — and
 * is turned into a PDF on the phone. Nothing is summarised away: every booking,
 * review, message and support reply in the export is in here. The JSON is still
 * offered beside it, for the rare person who wants to move their data rather
 * than read it.
 *
 * Built here, from the response, rather than on the server: the server already
 * answers with everything, the phone already knows the customer's language and
 * time zone for the dates, and a second "pretty" endpoint would be a second
 * place to forget a field.
 */
export function exportDocumentHtml(
  data: AccountExport,
  format: (minor: number | null | undefined, code?: string | null) => string,
): string {
  const day = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
  const moment = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : '';
  // Everything a customer typed is escaped: a message containing "<b>" is
  // shown as written, not obeyed.
  const esc = (value: string | null | undefined) =>
    (value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

  const { account } = data;

  const facts = [
    ['Email', esc(account.email)],
    ['Name on your reviews', account.displayName ? esc(account.displayName) : 'Anonymous'],
    ['With us since', day(account.createdAt)],
    ['Your district', account.homeDistrict ? esc(account.homeDistrict.name) : 'Not chosen'],
    [
      'Address for weekly offers',
      account.homeLatitude !== null && account.homeLongitude !== null
        ? `${account.homeLabel ? `${esc(account.homeLabel)} — ` : ''}${account.homeLatitude.toFixed(5)}, ${account.homeLongitude.toFixed(5)}`
        : 'Not saved',
    ],
    [
      'Weekly offers by email',
      account.offersOptInAt ? `On, since ${day(account.offersOptInAt)}` : 'Off',
    ],
  ]
    .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
    .join('');

  const bookings = data.bookings
    .map((b) => {
      const status = BOOKING_STATUS[b.status];
      return `
      <div class="item">
        <div class="row">
          <div class="strong">${esc(b.service.name)}</div>
          <div class="tag">${esc(status.label)}</div>
        </div>
        <div class="muted">${esc(b.location.name)} · ${esc(b.location.address)}</div>
        <table class="mini">
          <tr><th>When</th><td>${moment(b.startTime)}</td></tr>
          <tr><th>Price</th><td>${format(b.servicePriceMinor, b.currency)}</td></tr>
          <tr><th>Deposit</th><td>${format(b.depositAmountMinor, b.currency)}${
            b.depositPaidAt ? `, paid ${day(b.depositPaidAt)}` : ', not paid'
          }</td></tr>
          ${
            b.cancelledAt
              ? `<tr><th>Cancelled</th><td>${day(b.cancelledAt)}${
                  b.cancellationReason ? ` — ${esc(b.cancellationReason)}` : ''
                }</td></tr>`
              : ''
          }
          <tr><th>Booked on</th><td>${day(b.createdAt)}</td></tr>
        </table>
      </div>`;
    })
    .join('');

  const reviews = data.reviews
    .map(
      (r) => `
      <div class="item">
        <div class="row">
          <div class="strong">${esc(r.location.name)}</div>
          <div class="stars">${stars(r.rating)}</div>
        </div>
        <div class="muted">${day(r.createdAt)}${r.editedAt ? ` · edited ${day(r.editedAt)}` : ''}</div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
      </div>`,
    )
    .join('');

  const talk = (
    messages: Array<{ from: string; body: string | null; sentAt: string; photoUrl?: string | null }>,
  ) =>
    messages
      .map(
        (m) => `
        <div class="msg ${m.from === 'you' ? 'mine' : ''}">
          <div class="who">${m.from === 'you' ? 'You' : esc(m.from)} · ${moment(m.sentAt)}</div>
          <div>${m.body ? esc(m.body) : ''}${m.photoUrl ? '<span class="muted">[a photo]</span>' : ''}</div>
        </div>`,
      )
      .join('');

  const conversations = data.conversations
    .map(
      (c) => `
      <div class="item">
        <div class="strong">${esc(c.with ?? 'A business')}</div>
        <div class="muted">Started ${day(c.startedAt)} · ${c.messages.length} message${
          c.messages.length === 1 ? '' : 's'
        }</div>
        ${talk(c.messages)}
      </div>`,
    )
    .join('');

  const tickets = data.supportTickets
    .map(
      (t) => `
      <div class="item">
        <div class="row">
          <div class="strong">${esc(t.subject)}</div>
          <div class="tag">${esc(TICKET_STATUS[t.status].label)}</div>
        </div>
        <div class="muted">Opened ${day(t.createdAt)}</div>
        ${talk(t.messages)}
      </div>`,
    )
    .join('');

  const section = (title: string, count: number, body: string, empty: string) => `
    <h2>${title} <span class="count">${count}</span></h2>
    ${count === 0 ? `<p class="muted">${empty}</p>` : body}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your data</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #15171C; font-size: 12.5px; line-height: 1.5; margin: 0; padding: 10px; }
  .cover { background: #15171C; color: #fff; border-radius: 16px; padding: 22px 24px; }
  .cover h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.3px; }
  .cover p { margin: 0; color: rgba(255,255,255,0.7); }
  .cover .who { margin-top: 14px; font-size: 15px; font-weight: 700; color: #fff; }
  .counts { display: flex; gap: 8px; margin-top: 14px; }
  .counts div { flex: 1; background: rgba(255,255,255,0.1); border-radius: 10px; padding: 9px 6px; text-align: center; }
  .counts b { display: block; font-size: 18px; }
  .counts span { font-size: 10.5px; color: rgba(255,255,255,0.7); }
  h2 { font-size: 16px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #F0532D; }
  .count { font-size: 11px; font-weight: 700; color: #F0532D; background: #FFEEE8; border-radius: 999px; padding: 2px 8px; vertical-align: middle; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; color: #8B909B; width: 34%; padding: 5px 8px 5px 0; vertical-align: top; }
  td { padding: 5px 0; }
  .facts tr + tr th, .facts tr + tr td { border-top: 1px solid #ECE9E3; }
  .item { border: 1px solid #ECE9E3; border-radius: 12px; padding: 12px 14px; margin-bottom: 9px; page-break-inside: avoid; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .strong { font-weight: 700; font-size: 13.5px; }
  .muted { color: #8B909B; }
  .tag { font-size: 10.5px; font-weight: 700; background: #F3F1EC; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .stars { color: #FFB020; letter-spacing: 1px; white-space: nowrap; }
  .mini { margin-top: 6px; }
  .mini th { width: 26%; padding: 2px 8px 2px 0; }
  .mini td { padding: 2px 0; }
  p { margin: 7px 0 0; }
  .msg { background: #F6F4F0; border-radius: 10px; padding: 7px 10px; margin-top: 6px; }
  .msg.mine { background: #FFEEE8; }
  .who { font-size: 10.5px; font-weight: 700; color: #8B909B; }
  .foot { margin-top: 26px; color: #8B909B; font-size: 10.5px; text-align: center; }
</style>
</head>
<body>
  <div class="cover">
    <h1>Your data</h1>
    <p>Everything we hold about you, as of ${moment(data.exportedAt)}.</p>
    <div class="who">${account.displayName ? esc(account.displayName) : esc(account.email)}</div>
    <div class="counts">
      <div><b>${data.bookings.length}</b><span>Bookings</span></div>
      <div><b>${data.reviews.length}</b><span>Reviews</span></div>
      <div><b>${data.conversations.length}</b><span>Conversations</span></div>
      <div><b>${data.supportTickets.length}</b><span>Support requests</span></div>
    </div>
  </div>

  <h2>Your account</h2>
  <table class="facts">${facts}</table>

  ${section('Your bookings', data.bookings.length, bookings, 'You have not booked anything yet.')}
  ${section('Your reviews', data.reviews.length, reviews, 'You have not written a review yet.')}
  ${section('Your messages', data.conversations.length, conversations, 'You have not messaged a business yet.')}
  ${section('Your support requests', data.supportTickets.length, tickets, 'You have not asked support for help yet.')}

  <div class="foot">
    This document was made on your phone from your account. A technical copy of the same
    data (JSON) is available from the same place in the app.
  </div>
</body>
</html>`;
}
