/**
 * Test accounts (§316): the console's statistics leave out our own test
 * accounts and the demo's, so the numbers the team pitches with are real.
 */

/** The domains set aside for examples (RFC 2606): no real person holds an address there. */
const EXAMPLE_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);

/**
 * Top-level names that are never real mail (RFC 2606). Not "invalid": a
 * CLOSED account's address is moved there (§122), and those were real people.
 */
const TEST_TLD = /\.(test|example|localhost)$/i;

/** Whether an address can only belong to a test account. */
export function isTestEmail(email: string): boolean {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
  return EXAMPLE_DOMAINS.has(domain) || TEST_TLD.test(domain);
}

/** What a new account or shop is written with, when its address is a test one. */
export const testMarkFor = (email: string) =>
  isTestEmail(email) ? { isTest: true, testMarkedAt: new Date(), testMarkedBy: 'automatic' } : {};
