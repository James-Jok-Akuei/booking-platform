import { BusinessDocumentKind as K, BusinessDocumentStatus as S } from '@prisma/client';
import { allPacks, packFor } from '../countries/packs';
import { msg } from '../i18n/say';

/**
 * Business papers (§314): what a shop may upload, which kinds of shop MUST
 * hold a licence before they go live, and which papers earn the "Registered
 * business" mark customers see.
 *
 * Only licensed trades are blocked: a clinic, a lab, a tour operator, a
 * lawyer. A barber or a car wash may list without any paper, and earns the
 * mark by uploading its registration.
 *
 * The rules themselves are the shop's COUNTRY's (§315) — which trades need a
 * licence, and which papers prove registration, are a country's law — so they
 * live in its pack (`src/countries/packs/`). Everything here takes the shop's
 * country and asks it.
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

/** What a licensed trade must hold: at least ONE of `kinds`, checked by our team. */
export interface PaperRule {
  key: 'health' | 'veterinary' | 'tourism' | 'legal';
  kinds: K[];
}

/** The papers that earn "Registered business" in a country once checked (§314). */
export const registrationKinds = (countryCode: string): readonly K[] => packFor(countryCode)?.papers.registration ?? [];

/**
 * Every country's registration papers together, for a query across shops.
 * Safe as one list because a shop can only upload its own country's papers
 * (`paperKinds`), so an RDB certificate is only ever a Rwandan shop's.
 */
export const ALL_REGISTRATION_KINDS: K[] = [...new Set(allPacks().flatMap((p) => p.papers.registration))];

/** Every paper a shop in this country may upload. */
export const paperKinds = (countryCode: string): readonly K[] => packFor(countryCode)?.papers.kinds ?? [];

export type ShopKindNames = { category: { name: string }; subcategory: { name: string } };

/** The rules a shop in `countryCode` falls under, by its kinds — each once. */
export function requiredPapers(countryCode: string, kinds: ShopKindNames[]): PaperRule[] {
  const rules = packFor(countryCode)?.papers.rules ?? [];
  const out = new Map<PaperRule['key'], PaperRule>();
  for (const kind of kinds) {
    for (const entry of rules) {
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

/** "Registered business": a registration paper of the shop's country our team checked, still standing. */
export const isRegistered = (countryCode: string, docs: PaperLike[], now = new Date()) =>
  docs.some((d) => registrationKinds(countryCode).includes(d.kind) && isChecked(d, now));

/** A registration paper uploaded, checked or not — what the shop's own checklist ticks. */
export const hasRegistration = (countryCode: string, docs: PaperLike[], now = new Date()) =>
  docs.some((d) => registrationKinds(countryCode).includes(d.kind) && inHand(d, now));

/** How long before a paper runs out that the shop is reminded (§314). */
export const EXPIRY_WARNING_DAYS = 30;
