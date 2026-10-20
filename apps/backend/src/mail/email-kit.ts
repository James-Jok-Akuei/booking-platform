/**
 * The platform's emails, as one design (§292).
 *
 * Every email is the same frame — the mark and the name above a white card,
 * a coloured top that says at a glance what kind of news it is, the thing
 * itself (a booking as a ticket, a code as six boxes, money as one big
 * figure), one button, and a quiet footer that says why it came — built from
 * the blocks below. Each block is written twice, as HTML and as plain text,
 * so the text part of every email says the same thing as the picture.
 *
 * Email is not the web. What follows is tables and inline styles, because
 * that is what Gmail, Outlook and phone mail apps all draw; a <style> block
 * only adds what some can do on top — the brand's font, phone sizes, dark
 * mode — and every email still reads right where it is stripped. Every word
 * that came from a person is escaped: a reason, a message, a shop's name can
 * never become markup in an email from our address.
 */

// ---------------------------------------------------------------------------
// The brand
// ---------------------------------------------------------------------------

/** The apps' own colours (customer app theme, §241). */
export const C = {
  canvas: '#F4F1EB',
  panel: '#FFFFFF',
  sunken: '#F6F4F0',
  line: '#ECE8E1',
  ink: '#1F2A1F',
  ink2: '#4A554A',
  muted: '#7D867D',
  faint: '#A6ADA6',
  accent: '#F0532D',
  accentDeep: '#D7421E',
  accentSoft: '#FFEEE8',
  ok: '#0E9F54',
  okDeep: '#0B7A41',
  okSoft: '#E5F6EC',
  warn: '#C27803',
  warnDeep: '#8F5600',
  warnSoft: '#FFF3DC',
  danger: '#D92D20',
  dangerSoft: '#FDECEA',
  ask: '#2456C7',
  askSoft: '#EAF1FF',
  night: '#1F2A1F',
  /** The logo's own orange, for the wordmark. */
  logo: '#FD7511',
} as const;

export const BRAND = 'BwanguReservations';

const FONT = "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** What kind of news it is, said by colour before a word is read. */
export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'night';

const TONES: Record<Tone, { soft: string; solid: string; deep: string }> = {
  accent: { soft: '#FFF1EB', solid: C.accent, deep: C.accentDeep },
  ok: { soft: '#E8F6EE', solid: C.ok, deep: C.okDeep },
  warn: { soft: '#FFF4DF', solid: C.warn, deep: C.warnDeep },
  danger: { soft: '#FDEEEC', solid: C.danger, deep: C.danger },
  info: { soft: '#ECF2FF', solid: C.ask, deep: C.ask },
  night: { soft: C.night, solid: C.accent, deep: '#FFB547' },
};

// ---------------------------------------------------------------------------
// Small tools
// ---------------------------------------------------------------------------

/** Anything a person typed, made safe to put in an email. */
export const esc = (value: string | number | null | undefined) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** A piece of an email, drawn twice: as the picture and as plain text. */
export interface Block {
  html: string;
  text: string;
}

const block = (html: string, text: string): Block => ({ html, text });

/** A row of the card's body, with the card's own side padding. */
const row = (inner: string, pad = '0 40px 24px') => `<tr><td class="em-px" style="padding:${pad}">${inner}</td></tr>`;

const p = (style: string, inner: string) => `<p style="margin:0;${style}">${inner}</p>`;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Paragraphs of plain words; a blank line starts a new one. */
export function prose(text: string): Block {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return block('', '');
  const html = paragraphs
    .map((para, i) =>
      p(
        `font-family:${FONT};font-size:16px;line-height:26px;color:${C.ink2};${i ? 'padding-top:14px;' : ''}`,
        `<span class="em-ink2">${esc(para).replace(/\n/g, '<br>')}</span>`,
      ),
    )
    .join('');
  return block(row(html), paragraphs.join('\n\n'));
}

/** Labels and values, in a soft panel: the details someone looks up. */
export function facts(rows: Array<{ label: string; value: string; strong?: boolean }>): Block {
  if (rows.length === 0) return block('', '');
  const html = rows
    .map(
      (r, i) =>
        '<tr>' +
        `<td class="em-muted em-line" valign="top" style="padding:13px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};width:38%">${esc(r.label)}</td>` +
        `<td class="em-ink em-line" valign="top" align="right" style="padding:13px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:${r.strong ? 16 : 14.5}px;line-height:20px;font-weight:${r.strong ? 800 : 650};color:${C.ink}">${esc(r.value)}</td>` +
        '</tr>',
    )
    .join('');
  return block(
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-sunken" style="background:${C.sunken};border-radius:18px"><tr><td style="padding:6px 20px">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${html}</table>` +
        '</td></tr></table>',
    ),
    rows.map((r) => `${r.label}: ${r.value}`).join('\n'),
  );
}

/** Someone's own words, set apart: a message, a review, a reason. */
export function quote(text: string, by?: string | null): Block {
  const words = text.trim().replace(/^["“]|["”]$/g, '');
  return block(
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-sunken" style="background:${C.sunken};border-radius:18px"><tr>` +
        `<td width="4" style="width:4px;background:${C.accent};border-radius:4px 0 0 4px;font-size:0;line-height:0">&nbsp;</td>` +
        `<td style="padding:18px 22px">` +
        p(
          `font-family:${FONT};font-size:16px;line-height:25px;color:${C.ink};font-weight:600`,
          `<span class="em-ink">&ldquo;${esc(words).replace(/\n/g, '<br>')}&rdquo;</span>`,
        ) +
        (by
          ? p(
              `font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};padding-top:8px`,
              `&mdash; ${esc(by)}`,
            )
          : '') +
        '</td></tr></table>',
    ),
    `"${words}"${by ? ` — ${by}` : ''}`,
  );
}

/** A message someone wrote, read whole and signed — a shop's news, our announcement. */
export function letter(text: string, from: string | null): Block {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean);
  const html = paragraphs
    .map((para, i) =>
      p(
        `font-family:${FONT};font-size:17px;line-height:27px;color:${C.ink};${i ? 'padding-top:14px;' : ''}`,
        `<span class="em-ink">${esc(para).replace(/\n/g, '<br>')}</span>`,
      ),
    )
    .join('');
  return block(
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-sunken" style="background:${C.sunken};border-radius:20px"><tr><td style="padding:24px 26px">` +
        html +
        (from
          ? p(
              `font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;color:${C.accentDeep};padding-top:16px`,
              `&mdash; ${esc(from)}`,
            )
          : '') +
        '</td></tr></table>',
    ),
    `${paragraphs.join('\n\n')}${from ? `\n— ${from}` : ''}`,
  );
}

/** A short note in a colour: what to watch for, or what happens next. */
export function notice(tone: Exclude<Tone, 'night'>, text: string, title?: string): Block {
  const t = TONES[tone];
  return block(
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-note-${tone}" style="background:${t.soft};border-radius:16px"><tr><td style="padding:16px 20px">` +
        (title
          ? p(
              `font-family:${FONT};font-size:14.5px;line-height:21px;font-weight:800;color:${t.deep};padding-bottom:3px`,
              esc(title),
            )
          : '') +
        p(
          `font-family:${FONT};font-size:14.5px;line-height:22px;color:${C.ink2}`,
          `<span class="em-ink2">${esc(text).replace(/\n/g, '<br>')}</span>`,
        ) +
        '</td></tr></table>',
    ),
    `${title ? `${title} ` : ''}${text}`,
  );
}

/** Six boxes, the way the apps ask for a code (§183). */
export function codeBoxes(code: string, opts: { onDark?: boolean; label?: string; note?: string } = {}): Block {
  const dark = Boolean(opts.onDark);
  const boxes = code
    .split('')
    .map(
      (digit) =>
        '<td style="padding:0 4px">' +
        `<div class="${dark ? '' : 'em-codebox'}" style="box-sizing:border-box;width:46px;height:60px;line-height:56px;border-radius:14px;text-align:center;` +
        (dark
          ? `background:#FFFFFF;border:2px solid #FFFFFF;color:${C.ink};`
          : `background:${C.accentSoft};border:2px solid #FBD9CD;color:${C.ink};`) +
        `font-family:${FONT};font-size:28px;font-weight:800">${esc(digit)}</div></td>`,
    )
    .join('');
  const label = opts.label
    ? p(
        `font-family:${FONT};font-size:12px;line-height:16px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${dark ? '#FFB547' : C.accentDeep};padding-bottom:12px;text-align:center`,
        esc(opts.label),
      )
    : '';
  const note = opts.note
    ? p(
        `font-family:${FONT};font-size:14px;line-height:21px;color:${dark ? 'rgba(255,255,255,0.72)' : C.ink2};padding-top:14px;text-align:center`,
        `<span class="${dark ? '' : 'em-ink2'}">${esc(opts.note)}</span>`,
      )
    : '';
  const html =
    label +
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>${boxes}</tr></table>` +
    note;
  return block(
    dark ? html : row(html, '4px 24px 28px'),
    `${opts.label ? `${opts.label}: ` : ''}${code}${opts.note ? `\n${opts.note}` : ''}`,
  );
}

/** Money as one big figure, with what it is and where it went. */
export function amount(opts: { label: string; value: string; tone?: Exclude<Tone, 'night'>; lines?: string[] }): Block {
  const t = TONES[opts.tone ?? 'ok'];
  return block(
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-line" style="border:1px solid ${C.line};border-radius:20px"><tr><td style="padding:22px 24px">` +
        p(
          `font-family:${FONT};font-size:12px;line-height:16px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${t.deep}`,
          esc(opts.label),
        ) +
        p(
          `font-family:${FONT};font-size:38px;line-height:44px;font-weight:800;letter-spacing:-1px;color:${C.ink};padding-top:6px`,
          `<span class="em-ink">${esc(opts.value)}</span>`,
        ) +
        (opts.lines ?? [])
          .map((line) =>
            p(
              `font-family:${FONT};font-size:14px;line-height:21px;color:${C.muted};padding-top:4px`,
              `<span class="em-muted">${esc(line)}</span>`,
            ),
          )
          .join('') +
        '</td></tr></table>',
    ),
    `${opts.label}: ${opts.value}${opts.lines?.length ? `\n${opts.lines.join('\n')}` : ''}`,
  );
}

/** A list of short items — a morning's bookings — each with its time. */
export function list(items: Array<{ when: string; title: string; detail?: string | null }>): Block {
  const html = items
    .map(
      (item, i) =>
        '<tr>' +
        `<td class="em-line" valign="top" style="padding:14px 14px 14px 0;${i ? `border-top:1px solid ${C.line};` : ''}width:92px;font-family:${FONT};font-size:13px;line-height:20px;font-weight:800;color:${C.accentDeep};white-space:nowrap">${esc(item.when)}</td>` +
        `<td class="em-line" valign="top" style="padding:14px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT}">` +
        p(
          `font-size:15px;line-height:21px;font-weight:700;color:${C.ink}`,
          `<span class="em-ink">${esc(item.title)}</span>`,
        ) +
        (item.detail
          ? p(
              `font-size:13.5px;line-height:20px;color:${C.muted};padding-top:2px`,
              `<span class="em-muted">${esc(item.detail)}</span>`,
            )
          : '') +
        '</td></tr>',
    )
    .join('');
  return block(
    row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${html}</table>`),
    items.map((item) => `${item.when} — ${item.title}${item.detail ? ` (${item.detail})` : ''}`).join('\n'),
  );
}

/**
 * Things still to do, each with an empty box beside it (§303) — advice, read
 * down a list and ticked off in the reader's own time.
 */
export function todo(items: Array<{ title: string; detail?: string | null }>): Block {
  if (items.length === 0) return block('', '');
  const html = items
    .map(
      (item, i) =>
        '<tr>' +
        `<td class="em-line" valign="top" style="padding:14px 14px 14px 0;${i ? `border-top:1px solid ${C.line};` : ''}width:22px">` +
        `<div style="width:16px;height:16px;border:2px solid ${C.accent};border-radius:6px;margin-top:1px;font-size:0;line-height:0">&nbsp;</div>` +
        '</td>' +
        `<td class="em-line" valign="top" style="padding:14px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT}">` +
        p(`font-size:15px;line-height:21px;font-weight:700;color:${C.ink}`, `<span class="em-ink">${esc(item.title)}</span>`) +
        (item.detail
          ? p(
              `font-size:13.5px;line-height:20px;color:${C.muted};padding-top:2px`,
              `<span class="em-muted">${esc(item.detail)}</span>`,
            )
          : '') +
        '</td></tr>',
    )
    .join('');
  return block(
    row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${html}</table>`),
    items.map((item) => `[ ] ${item.title}${item.detail ? ` — ${item.detail}` : ''}`).join('\n'),
  );
}

/** A booking, as a ticket: what, where, when, and what is left to pay (§292). */
export interface Ticket {
  photoUrl?: string | null;
  service: string;
  quantity?: number;
  shop: string;
  shopLogoUrl?: string | null;
  /** "TUE", "20", "Oct" — the date tile. */
  weekday: string;
  day: string;
  month: string;
  /** "Tuesday 20 October · 11:15 – 12:15". */
  when: string;
  branch: string;
  address?: string | null;
  reservation: string;
  status?: { label: string; tone: Exclude<Tone, 'night'> } | null;
  money?: Array<{ label: string; value: string }>;
  /**
   * What was chosen (§300), under the money: the answers, a line saying
   * private answers are in the app — never what they are — and the note.
   */
  extras?: { label: string; lines: string[]; privateNote: string | null; note: string | null } | null;
  links?: Array<{ label: string; url: string }>;
}

export function ticket(t: Ticket): Block {
  const tone = t.status ? TONES[t.status.tone] : null;
  const photo = t.photoUrl
    ? `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${esc(t.photoUrl)}" width="520" alt="" class="em-photo" style="display:block;width:100%;max-width:520px;height:200px;object-fit:cover;border-radius:20px 20px 0 0;border:0"></td></tr>`
    : '';
  const tile =
    `<table role="presentation" cellpadding="0" cellspacing="0" class="em-tile" style="border:1px solid ${C.line};border-radius:16px;background:${C.panel}"><tr><td align="center" style="width:64px;padding:8px 0 10px;font-family:${FONT}">` +
    p(
      `font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.2px;color:${C.accent}`,
      esc(t.weekday.toUpperCase()),
    ) +
    p(
      `font-size:28px;line-height:32px;font-weight:800;letter-spacing:-0.5px;color:${C.ink}`,
      `<span class="em-ink">${esc(t.day)}</span>`,
    ) +
    p(`font-size:12px;line-height:14px;font-weight:700;color:${C.muted}`, esc(t.month)) +
    '</td></tr></table>';
  const shopLine =
    (t.shopLogoUrl
      ? `<img src="${esc(t.shopLogoUrl)}" width="20" height="20" alt="" style="display:inline-block;width:20px;height:20px;border-radius:6px;vertical-align:-5px;margin-right:6px;border:0;object-fit:cover">`
      : '') + esc(t.shop);
  const chip = t.status
    ? `<span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${tone!.soft};color:${tone!.deep};font-family:${FONT};font-size:12px;line-height:14px;font-weight:800;white-space:nowrap">&#9679;&nbsp;${esc(t.status.label)}</span>`
    : '';
  const head =
    '<tr><td style="padding:20px 22px 18px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    `<td width="66" valign="top" style="width:66px">${tile}</td>` +
    `<td valign="top" style="padding-left:16px;font-family:${FONT}">` +
    (chip ? `<div style="padding-bottom:8px">${chip}</div>` : '') +
    p(
      `font-size:20px;line-height:26px;font-weight:800;letter-spacing:-0.3px;color:${C.ink}`,
      `<span class="em-ink">${esc(t.service)}${t.quantity && t.quantity > 1 ? ` <span style="color:${C.muted};font-weight:700">&times;&nbsp;${t.quantity}</span>` : ''}</span>`,
    ) +
    p(
      `font-size:14.5px;line-height:22px;font-weight:650;color:${C.ink2};padding-top:4px`,
      `<span class="em-ink2">${shopLine}</span>`,
    ) +
    p(
      `font-size:14px;line-height:21px;color:${C.muted};padding-top:2px`,
      `<span class="em-muted">${esc(t.when)}</span>`,
    ) +
    '</td></tr></table></td></tr>';
  // The perforation between the ticket and its stub.
  const tear = `<tr><td style="padding:0 22px"><div class="em-line" style="border-top:2px dashed ${C.line};height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>`;
  const cells = [
    { label: 'Where', value: t.branch, sub: t.address ?? null },
    { label: 'Booking no.', value: t.reservation, sub: null },
    ...(t.money ?? []).map((m) => ({ label: m.label, value: m.value, sub: null })),
  ];
  const pairs: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const pair = cells.slice(i, i + 2);
    pairs.push(
      '<tr>' +
        pair
          .map(
            (c, j) =>
              `<td class="em-stack" valign="top" width="50%" style="width:50%;padding:0 ${j ? 0 : 12}px 16px 0;font-family:${FONT}">` +
              p(
                `font-size:11.5px;line-height:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${C.faint}`,
                esc(c.label),
              ) +
              p(
                `font-size:15px;line-height:21px;font-weight:700;color:${C.ink};padding-top:3px`,
                `<span class="em-ink">${esc(c.value)}</span>`,
              ) +
              (c.sub
                ? p(
                    `font-size:13px;line-height:19px;color:${C.muted};padding-top:1px`,
                    `<span class="em-muted">${esc(c.sub)}</span>`,
                  )
                : '') +
              '</td>',
          )
          .join('') +
        (pair.length === 1 ? '<td class="em-stack" width="50%" style="width:50%">&nbsp;</td>' : '') +
        '</tr>',
    );
  }
  const stub = `<tr><td style="padding:18px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pairs.join('')}</table></td></tr>`;
  const extras = t.extras
    ? `<tr><td style="padding:0 22px 18px;font-family:${FONT}">` +
      p(
        `font-size:11.5px;line-height:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${C.faint}`,
        esc(t.extras.label),
      ) +
      t.extras.lines
        .map((line) =>
          p(`font-size:15px;line-height:22px;font-weight:700;color:${C.ink};padding-top:3px`, `<span class="em-ink">${esc(line)}</span>`),
        )
        .join('') +
      (t.extras.privateNote
        ? p(`font-size:13.5px;line-height:20px;font-weight:700;color:${C.danger};padding-top:6px`, `&#128274;&nbsp;${esc(t.extras.privateNote)}`)
        : '') +
      (t.extras.note
        ? p(
            `font-size:14px;line-height:21px;font-style:italic;color:${C.ink2};padding-top:6px`,
            `<span class="em-ink2">&ldquo;${esc(t.extras.note)}&rdquo;</span>`,
          )
        : '') +
      '</td></tr>'
    : '';
  const links = t.links?.length
    ? `<tr><td class="em-sunken" style="padding:14px 22px;background:${C.sunken};border-radius:0 0 20px 20px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700">` +
      t.links
        .map(
          (l) =>
            `<a href="${esc(l.url)}" style="color:${C.accentDeep};text-decoration:none;white-space:nowrap">${esc(l.label)}&nbsp;&rarr;</a>`,
        )
        .join(`<span style="color:${C.faint}">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`) +
      '</td></tr>'
    : '';
  const html = row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card em-line" style="background:${C.panel};border:1px solid ${C.line};border-radius:22px">` +
      photo +
      head +
      tear +
      stub +
      extras +
      links +
      '</table>',
  );
  const text = [
    `${t.service}${t.quantity && t.quantity > 1 ? ` × ${t.quantity}` : ''} — ${t.shop}`,
    t.status ? `Status: ${t.status.label}` : null,
    `When: ${t.when}`,
    `Where: ${t.branch}${t.address ? `, ${t.address}` : ''}`,
    `Booking no.: ${t.reservation}`,
    ...(t.money ?? []).map((m) => `${m.label}: ${m.value}`),
    ...(t.extras ? [`${t.extras.label}:`, ...t.extras.lines.map((line) => `  ${line}`)] : []),
    t.extras?.privateNote ?? null,
    t.extras?.note ? `Note: “${t.extras.note}”` : null,
    ...(t.links ?? []).map((l) => `${l.label}: ${l.url}`),
  ]
    .filter(Boolean)
    .join('\n');
  return block(html, text);
}

/** Services as picture cards — the weekly "Popular near you" (§140). */
export function serviceCards(
  items: Array<{
    photoUrl: string | null;
    name: string;
    shop: string;
    facts: string;
    price: string;
    was?: string | null;
    off?: number | null;
  }>,
): Block {
  const card = (s: (typeof items)[number]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card em-line" style="background:${C.panel};border:1px solid ${C.line};border-radius:20px">` +
    '<tr><td style="padding:0;font-size:0;line-height:0;position:relative">' +
    (s.photoUrl
      ? `<img src="${esc(s.photoUrl)}" width="252" alt="" style="display:block;width:100%;height:150px;object-fit:cover;border-radius:20px 20px 0 0;border:0">`
      : `<div style="height:150px;line-height:150px;border-radius:20px 20px 0 0;background:${C.accentSoft};text-align:center;font-family:${FONT};font-size:56px;font-weight:800;color:${C.accent}">${esc(s.name.trim().charAt(0).toUpperCase())}</div>`) +
    '</td></tr>' +
    `<tr><td style="padding:14px 16px 16px;font-family:${FONT}">` +
    p(`font-size:16px;line-height:22px;font-weight:800;color:${C.ink}`, `<span class="em-ink">${esc(s.name)}</span>`) +
    p(
      `font-size:13px;line-height:19px;color:${C.muted};padding-top:3px`,
      `<span class="em-muted">${esc(s.shop)}<br>${esc(s.facts)}</span>`,
    ) +
    p(
      `font-size:17px;line-height:24px;font-weight:800;color:${s.off ? C.accentDeep : C.ink};padding-top:8px`,
      `<span class="${s.off ? '' : 'em-ink'}">${esc(s.price)}</span>` +
        (s.was
          ? ` <span style="font-size:13px;font-weight:600;color:${C.faint};text-decoration:line-through">${esc(s.was)}</span>`
          : '') +
        (s.off
          ? ` <span style="display:inline-block;font-size:11px;line-height:13px;font-weight:800;color:#FFFFFF;background:${C.accentDeep};border-radius:999px;padding:3px 8px;vertical-align:2px">&minus;${s.off}%</span>`
          : ''),
    ) +
    '</td></tr></table>';
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2);
    rows.push(
      '<tr>' +
        pair
          .map(
            (s, j) =>
              `<td class="em-stack" valign="top" width="50%" style="width:50%;padding:0 ${j ? 0 : 8}px 16px ${j ? 8 : 0}px">${card(s)}</td>`,
          )
          .join('') +
        (pair.length === 1 ? '<td class="em-stack" width="50%" style="width:50%">&nbsp;</td>' : '') +
        '</tr>',
    );
  }
  return block(
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`,
      '0 40px 8px',
    ),
    items
      .map((s) => `${s.name} — ${s.price}${s.off ? ` (${s.off}% off, was ${s.was})` : ''}\n${s.shop} · ${s.facts}`)
      .join('\n\n'),
  );
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** What sits in the top corner of the card's coloured top. */
export type Badge =
  | { kind: 'glyph'; glyph: string }
  | { kind: 'date'; weekday: string; day: string }
  | { kind: 'image'; url: string }
  | { kind: 'brand' };

export interface Email {
  /** The line inboxes show after the subject. */
  preheader: string;
  /** Who it is for: says "For your shop" or "Admin" by the name. */
  audience?: 'CUSTOMER' | 'BUSINESS' | 'ADMIN' | null;
  hero: {
    tone: Tone;
    badge?: Badge | null;
    eyebrow: string;
    title: string;
    lead?: string | null;
    /** Something drawn inside the top itself — a code, on a dark top. */
    inside?: Block | null;
  };
  blocks: Array<Block | null | false | undefined>;
  button?: { label: string; url: string } | null;
  /** Small links beside or under the button. */
  links?: Array<{ label: string; url: string }>;
  footer: {
    /** Why this came, in one sentence. */
    reason: string;
    manage?: { label: string; url?: string | null } | null;
    unsubscribeUrl?: string | null;
  };
}

/** Where the mark lives, so the email can load it (§292). */
export const markUrl = (assetBase: string) => `${assetBase.replace(/\/$/, '')}/email/mark.png`;

/** Plus Jakarta Sans, every weight in one file per alphabet, served with the emails' pictures (§299). */
const fontFaces = (assetBase: string) => {
  const base = `${assetBase.replace(/\/$/, '')}/email/fonts/plus-jakarta-sans`;
  const face = (file: string, range: string) =>
    `@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:400 800;font-display:swap;` +
    `src:url('${base}-${file}.woff2') format('woff2');unicode-range:${range}}`;
  return (
    face('latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C4,U+2C60-2C7F,U+A720-A7FF') +
    face('latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD')
  );
};

function badgeHtml(badge: Badge, tone: Tone, assetBase: string) {
  const t = TONES[tone];
  const night = tone === 'night';
  switch (badge.kind) {
    case 'brand':
    case 'image':
      return `<img src="${esc(badge.kind === 'brand' ? markUrl(assetBase) : badge.url)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:16px;border:0;object-fit:cover;background:#FFFFFF">`;
    case 'date':
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px"><tr><td align="center" style="width:56px;padding:7px 0 8px;font-family:${FONT}">` +
        p(
          `font-size:10.5px;line-height:13px;font-weight:800;letter-spacing:1.2px;color:${C.accent}`,
          esc(badge.weekday.toUpperCase()),
        ) +
        p(`font-size:24px;line-height:28px;font-weight:800;color:${C.ink}`, esc(badge.day)) +
        '</td></tr></table>'
      );
    case 'glyph':
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" style="width:56px;height:56px;border-radius:28px;background:${night ? C.accent : t.solid};` +
        `font-family:${FONT};font-size:26px;line-height:56px;font-weight:800;color:#FFFFFF">${badge.glyph}</td></tr></table>`
      );
  }
}

/** The whole email, as HTML and plain text. */
export function renderEmail(
  email: Email,
  opts: { assetBase: string; subject: string },
): { html: string; text: string } {
  const t = TONES[email.hero.tone];
  const night = email.hero.tone === 'night';
  const blocks = email.blocks.filter((b): b is Block => Boolean(b && (b.html || b.text)));
  const audienceLabel =
    email.audience === 'BUSINESS' ? 'For your shop' : email.audience === 'ADMIN' ? 'Admin console' : '';

  const header =
    '<tr><td class="em-px" style="padding:0 6px 18px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    `<td valign="middle" style="font-family:${FONT}">` +
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
    `<td valign="middle" style="padding-right:10px"><img src="${esc(markUrl(opts.assetBase))}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:10px;border:0"></td>` +
    `<td valign="middle" class="em-ink" style="font-family:${FONT};font-size:18px;line-height:22px;font-weight:800;letter-spacing:-0.4px;color:${C.ink}">Bwangu<span style="color:${C.logo}">Reservations</span></td>` +
    '</tr></table></td>' +
    (audienceLabel
      ? `<td align="right" valign="middle"><span class="em-chip" style="display:inline-block;padding:6px 12px;border-radius:999px;background:#EAE6DE;font-family:${FONT};font-size:12px;line-height:14px;font-weight:700;color:${C.ink2}">${esc(audienceLabel)}</span></td>`
      : '') +
    '</tr></table></td></tr>';

  const hero =
    `<tr><td class="em-hero em-hero-${email.hero.tone}" style="padding:36px 40px ${email.hero.inside ? 34 : 30}px;background-color:${t.soft};` +
    (night
      ? `background-image:radial-gradient(420px 260px at 100% 0%,rgba(240,83,45,0.55),rgba(240,83,45,0) 70%),radial-gradient(300px 200px at 0% 110%,rgba(14,159,84,0.22),rgba(14,159,84,0) 70%);`
      : `background-image:radial-gradient(360px 220px at 100% 0%,rgba(255,255,255,0.75),rgba(255,255,255,0) 70%);`) +
    `border-radius:${blocks.length || email.button ? '28px 28px 0 0' : '28px'}">` +
    (email.hero.badge
      ? `<div style="padding-bottom:20px">${badgeHtml(email.hero.badge, email.hero.tone, opts.assetBase)}</div>`
      : '') +
    p(
      `font-family:${FONT};font-size:12px;line-height:16px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${t.deep}`,
      esc(email.hero.eyebrow),
    ) +
    p(
      `font-family:${FONT};font-size:30px;line-height:37px;font-weight:800;letter-spacing:-0.8px;color:${night ? '#FFFFFF' : C.ink};padding-top:8px`,
      `<span class="em-h1 ${night ? '' : 'em-ink'}">${esc(email.hero.title)}</span>`,
    ) +
    (email.hero.lead
      ? p(
          `font-family:${FONT};font-size:16.5px;line-height:26px;color:${night ? 'rgba(255,255,255,0.78)' : C.ink2};padding-top:10px`,
          `<span class="${night ? '' : 'em-ink2'}">${esc(email.hero.lead)}</span>`,
        )
      : '') +
    (email.hero.inside ? `<div style="padding-top:26px">${email.hero.inside.html}</div>` : '') +
    '</td></tr>';

  const button = email.button
    ? row(
        '<table role="presentation" cellpadding="0" cellspacing="0" class="em-btn-wrap"><tr>' +
          `<td align="center" bgcolor="${C.accent}" style="border-radius:999px;background:${C.accent}">` +
          `<a href="${esc(email.button.url)}" class="em-btn" style="display:inline-block;padding:16px 30px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:800;color:#FFFFFF;text-decoration:none;border-radius:999px">${esc(email.button.label)}&nbsp;&nbsp;&rarr;</a>` +
          '</td></tr></table>' +
          (email.links?.length
            ? p(
                `font-family:${FONT};font-size:14px;line-height:22px;font-weight:700;padding-top:16px`,
                email.links
                  .map(
                    (l) =>
                      `<a href="${esc(l.url)}" style="color:${C.accentDeep};text-decoration:none">${esc(l.label)}</a>`,
                  )
                  .join(`<span style="color:${C.faint}">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`),
              )
            : ''),
        '6px 40px 34px',
      )
    : '';

  const manage = email.footer.manage
    ? email.footer.manage.url
      ? `<a href="${esc(email.footer.manage.url)}" style="color:${C.ink2};text-decoration:underline">${esc(email.footer.manage.label)}</a>`
      : esc(email.footer.manage.label)
    : '';
  const unsubscribe = email.footer.unsubscribeUrl
    ? `<a href="${esc(email.footer.unsubscribeUrl)}" style="color:${C.ink2};text-decoration:underline">Stop emails like this</a>`
    : '';
  const footer =
    `<tr><td align="center" class="em-px" style="padding:30px 24px 8px;font-family:${FONT}">` +
    `<img src="${esc(markUrl(opts.assetBase))}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border-radius:8px;border:0;margin:0 auto">` +
    p(
      `font-size:14px;line-height:20px;font-weight:800;letter-spacing:-0.2px;color:${C.ink};padding-top:8px;text-align:center`,
      `<span class="em-ink">Bwangu<span style="color:${C.logo}">Reservations</span></span>`,
    ) +
    p(
      `font-size:12.5px;line-height:20px;color:${C.muted};padding-top:16px;text-align:center`,
      `<span class="em-muted">${esc(email.footer.reason)}</span>` +
        (manage || unsubscribe
          ? `<br>${[manage, unsubscribe].filter(Boolean).join(`&nbsp;&nbsp;&middot;&nbsp;&nbsp;`)}`
          : ''),
    ) +
    p(
      `font-size:11.5px;line-height:18px;color:${C.faint};padding-top:14px;text-align:center`,
      `&copy; ${new Date().getFullYear()} ${BRAND}`,
    ) +
    '</td></tr>';

  const style = `
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
    a { text-decoration:none; }
    img { -ms-interpolation-mode:bicubic; }
    @media (max-width: 620px) {
      .em-px { padding-left:20px !important; padding-right:20px !important; }
      .em-hero { padding:28px 22px 24px !important; }
      .em-h1 { font-size:25px !important; line-height:31px !important; }
      .em-stack { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; }
      .em-btn-wrap, .em-btn-wrap td { width:100% !important; }
      .em-btn { display:block !important; text-align:center !important; }
      .em-photo { height:170px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .em-bg { background:#0E130E !important; }
      .em-card { background:#172017 !important; }
      .em-sunken { background:#1F291F !important; }
      .em-line { border-color:#2A352A !important; }
      .em-ink { color:#F2F1EC !important; }
      .em-ink2 { color:#C8CEC7 !important; }
      .em-muted { color:#8F988F !important; }
      .em-chip { background:#232D23 !important; color:#C8CEC7 !important; }
      .em-tile { background:#1F291F !important; border-color:#2A352A !important; }
      .em-codebox { background:#3A1D14 !important; border-color:#5A2A1C !important; color:#FFFFFF !important; }
      .em-hero-accent { background:#2B1A14 !important; background-image:none !important; }
      .em-hero-ok { background:#11291B !important; background-image:none !important; }
      .em-hero-warn { background:#2E230C !important; background-image:none !important; }
      .em-hero-danger { background:#311512 !important; background-image:none !important; }
      .em-hero-info { background:#121D36 !important; background-image:none !important; }
      .em-note-accent { background:#2B1A14 !important; }
      .em-note-ok { background:#11291B !important; }
      .em-note-warn { background:#2E230C !important; }
      .em-note-danger { background:#311512 !important; }
      .em-note-info { background:#121D36 !important; }
    }`;

  const html =
    '<!doctype html><html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' +
    `<title>${esc(opts.subject)}</title>` +
    // The brand's letters from our own server (§299), not Google's: opening an
    // email tells nobody else. Mail apps that do not load fonts use the fallbacks.
    `<style>${fontFaces(opts.assetBase)}</style>` +
    `<style>${style.replace(/\s+/g, ' ')}</style>` +
    `</head><body class="em-bg" style="margin:0;padding:0;background:${C.canvas}">` +
    // What inboxes show after the subject, then spacing so nothing else leaks in.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(email.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-bg" style="background:${C.canvas}"><tr><td align="center" style="padding:34px 12px 40px">` +
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">' +
    header +
    '<tr><td>' +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="background:${C.panel};border-radius:28px;border:1px solid #E8E3DA">` +
    hero +
    (blocks.length || button ? '<tr><td style="height:30px;font-size:0;line-height:0">&nbsp;</td></tr>' : '') +
    blocks.map((b) => b.html).join('') +
    button +
    (blocks.length && !button ? '<tr><td style="height:8px;font-size:0;line-height:0">&nbsp;</td></tr>' : '') +
    '</table></td></tr>' +
    footer +
    '</table>' +
    '<!--[if mso]></td></tr></table><![endif]-->' +
    '</td></tr></table></body></html>';

  const text = [
    `${BRAND}${audienceLabel ? ` · ${audienceLabel}` : ''}`,
    '',
    email.hero.eyebrow.toUpperCase(),
    email.hero.title,
    email.hero.lead ?? null,
    email.hero.inside?.text ?? null,
    ...blocks.map((b) => b.text),
    email.button ? `${email.button.label}: ${email.button.url}` : null,
    ...(email.links ?? []).map((l) => `${l.label}: ${l.url}`),
    '—',
    email.footer.reason,
    email.footer.manage
      ? `${email.footer.manage.label}${email.footer.manage.url ? `: ${email.footer.manage.url}` : ''}`
      : null,
    email.footer.unsubscribeUrl ? `Stop emails like this: ${email.footer.unsubscribeUrl}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');

  return { html, text };
}
