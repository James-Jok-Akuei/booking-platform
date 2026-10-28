import { BusinessDocumentKind as K, BusinessDocumentStatus as S } from '@prisma/client';
import { msg } from '../i18n/say';

/**
 * Business papers (§314): what a shop may upload, which kinds of shop MUST
 * hold a licence before they go live, and which papers earn the "Registered
 * business" mark customers see.
 *
 * Only licensed trades are blocked: a clinic, a lab, a tour operator, a
 * lawyer. A barber or a car wash may list without any paper, and earns the
 * mark by uploading its registration. Keyed by the category and type NAMES
 * the seed uses (§266), like the ready-made questions; a test keeps them in
 * step.
 */

/** Each kind of paper, as our team and the emails name it. */
export const KIND_WORDS: Record<K, string> = {
  RDB_CERTIFICATE: msg('RDB registration certificate'),
  TIN_CERTIFICATE: msg('Taxpayer registration (TIN)'),
  TRADING_LICENCE: msg('Trading licence'),
  HEALTH_FACILITY_LICENCE: msg('Health facility licence'),
  PROFESSIONAL_LICENCE: msg('Professional licence'),
  FDA_LICENCE: msg('Rwanda FDA licence'),
  TOURISM_LICENCE: msg('Tourism operating licence'),
  BAR_MEMBERSHIP: msg('Bar Association practising certificate'),
  OTHER: msg('Another paper'),
};

/** The papers that earn "Registered business" once checked (§314). */
export const REGISTRATION_KINDS: K[] = [K.RDB_CERTIFICATE, K.TIN_CERTIFICATE, K.TRADING_LICENCE];

/** What a licensed trade must hold: at least ONE of `kinds`, checked by our team. */
export interface PaperRule {
  key: 'health' | 'veterinary' | 'tourism' | 'legal';
  kinds: K[];
}

const HEALTH: PaperRule = { key: 'health', kinds: [K.HEALTH_FACILITY_LICENCE, K.PROFESSIONAL_LICENCE] };
const VETERINARY: PaperRule = { key: 'veterinary', kinds: [K.PROFESSIONAL_LICENCE, K.HEALTH_FACILITY_LICENCE] };
const TOURISM: PaperRule = { key: 'tourism', kinds: [K.TOURISM_LICENCE] };
const LEGAL: PaperRule = { key: 'legal', kinds: [K.BAR_MEMBERSHIP] };

/** Which kinds of shop need which paper. No `types`: every type of the category. */
export const PAPER_RULES: Array<{ category: string; types?: string[]; rule: PaperRule }> = [
  { category: 'Health & Medical', rule: HEALTH },
  {
    category: 'Wellness',
    types: ['Acupuncture', 'Diet & Nutrition', 'Chiropractic', 'Therapy', 'Physiotherapy & Rehab'],
    rule: HEALTH,
  },
  { category: 'Pet Services', types: ['Veterinary Clinic'], rule: VETERINARY },
  { category: 'Tours & Experiences', rule: TOURISM },
  { category: 'Hotels & Stays', types: ['Hotel Rooms', 'Guesthouses & Lodges', 'Apartments & Short Stays'], rule: TOURISM },
  { category: 'Services', types: ['Legal Consultation'], rule: LEGAL },
];

export type ShopKindNames = { category: { name: string }; subcategory: { name: string } };

/** The rules a shop falls under, by its kinds — each once. */
export function requiredPapers(kinds: ShopKindNames[]): PaperRule[] {
  const out = new Map<PaperRule['key'], PaperRule>();
  for (const kind of kinds) {
    for (const entry of PAPER_RULES) {
      if (entry.category !== kind.category.name) continue;
      if (entry.types && !entry.types.includes(kind.subcategory.name)) continue;
      out.set(entry.rule.key, entry.rule);
    }
  }
  return [...out.values()];
}

export type PaperLike = { kind: K; status: S; expiresAt: Date | null };

/** Not run out: no end date, or one still ahead. */
export const isCurrent = (doc: { expiresAt: Date | null }, now = new Date()) =>
  doc.expiresAt === null || doc.expiresAt.getTime() > now.getTime();

/** Uploaded and standing — waiting or checked, not refused, replaced or run out. */
export const inHand = (doc: PaperLike, now = new Date()) =>
  (doc.status === S.SUBMITTED || doc.status === S.VERIFIED) && isCurrent(doc, now);

/** Checked by our team, and standing. */
export const isChecked = (doc: PaperLike, now = new Date()) => doc.status === S.VERIFIED && isCurrent(doc, now);

export type RuleState = 'checked' | 'waiting' | 'missing';

/** Where a shop stands on one rule: checked, waiting for our team, or nothing in hand. */
export function ruleState(rule: PaperRule, docs: PaperLike[], now = new Date()): RuleState {
  const ours = docs.filter((d) => rule.kinds.includes(d.kind));
  if (ours.some((d) => isChecked(d, now))) return 'checked';
  if (ours.some((d) => inHand(d, now))) return 'waiting';
  return 'missing';
}

/** "Registered business": a registration paper our team checked, still standing. */
export const isRegistered = (docs: PaperLike[], now = new Date()) =>
  docs.some((d) => REGISTRATION_KINDS.includes(d.kind) && isChecked(d, now));

/** A registration paper uploaded, checked or not — what the shop's own checklist ticks. */
export const hasRegistration = (docs: PaperLike[], now = new Date()) =>
  docs.some((d) => REGISTRATION_KINDS.includes(d.kind) && inHand(d, now));

/** How long before a paper runs out that the shop is reminded (§314). */
export const EXPIRY_WARNING_DAYS = 30;
