import type { DocumentKind, PaperRule } from '../api/business';
import type { IconName } from '../ui/Icon';
import { t } from '@lingui/core/macro';

/**
 * Each business paper (§314), in the seller's words: what it is, who issues
 * it, why it matters, and whether it runs out. The server keeps the rules;
 * these are only the words.
 */
export type PaperWords = { name: string; issuer: string; why: string; expires: boolean; icon: IconName };

export const PAPER_WORDS: Record<DocumentKind, PaperWords> = {
  RDB_CERTIFICATE: {
    get name() { return t`RDB registration certificate`; },
    get issuer() { return t`Rwanda Development Board`; },
    get why() { return t`Proves the business is registered. Once checked, customers see the “Registered business” mark on your page.`; },
    expires: false,
    icon: 'legal',
  },
  TIN_CERTIFICATE: {
    get name() { return t`Taxpayer registration (TIN)`; },
    get issuer() { return t`Rwanda Revenue Authority`; },
    get why() { return t`For a sole trader registered for tax. Earns the “Registered business” mark too.`; },
    expires: false,
    icon: 'legal',
  },
  TRADING_LICENCE: {
    get name() { return t`Trading licence (ipatanti)`; },
    get issuer() { return t`Your district`; },
    get why() { return t`Renewed every year by 31 January. Shows the shop is trading this year, and earns the mark.`; },
    expires: true,
    icon: 'store',
  },
  HEALTH_FACILITY_LICENCE: {
    get name() { return t`Health facility licence`; },
    get issuer() { return t`Ministry of Health`; },
    get why() { return t`Required for a clinic, a lab, a dental or eye practice before it can go live.`; },
    expires: true,
    icon: 'shield',
  },
  PROFESSIONAL_LICENCE: {
    get name() { return t`Professional licence`; },
    get issuer() { return t`Your professional council`; },
    get why() { return t`The practitioner’s own licence — medical, dental, nursing, allied health or veterinary.`; },
    expires: true,
    icon: 'userCheck',
  },
  FDA_LICENCE: {
    get name() { return t`Rwanda FDA licence`; },
    get issuer() { return t`Rwanda Food and Drugs Authority`; },
    get why() { return t`For medicines, and what Rwanda FDA licenses.`; },
    expires: true,
    icon: 'shield',
  },
  TOURISM_LICENCE: {
    get name() { return t`Tourism operating licence`; },
    get issuer() { return t`Rwanda Development Board`; },
    get why() { return t`Required for tours, treks, safaris and places to stay before they can go live.`; },
    expires: true,
    icon: 'globe',
  },
  BAR_MEMBERSHIP: {
    get name() { return t`Bar Association practising certificate`; },
    get issuer() { return t`Rwanda Bar Association`; },
    get why() { return t`Required to offer legal advice before the shop can go live.`; },
    expires: true,
    icon: 'legal',
  },
  OTHER: {
    get name() { return t`Another paper`; },
    get issuer() { return ''; },
    get why() { return t`Any other permit or certificate you want on record with us.`; },
    expires: true,
    icon: 'paperclip',
  },
};

/** What a kind of shop must hold (§314), as the seller reads it. */
export const RULE_WORDS: Record<PaperRule['key'], string> = {
  get health() { return t`A health licence`; },
  get veterinary() { return t`A veterinary licence`; },
  get tourism() { return t`A tourism licence`; },
  get legal() { return t`A practising certificate`; },
};

/** The papers that earn the “Registered business” mark. */
export const REGISTRATION_KINDS: DocumentKind[] = ['RDB_CERTIFICATE', 'TIN_CERTIFICATE', 'TRADING_LICENCE'];
