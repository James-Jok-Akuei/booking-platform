import { BusinessMemberStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The digits of what was typed, ready to find inside a stored number (§289).
 *
 * Numbers are stored whole, "+250788100004". People type them every way: with
 * the leading 0 ("0788 100 004"), with the country code, in threes, or just
 * the end they remember. A leading 0 is dropped and the rest is looked for
 * inside — every one of those is then a part of the stored form. Fewer than
 * three digits is not a number anybody is looking for, and would match most.
 */
export function numberPart(q: string): string | null {
  const digits = q.replace(/\D/g, '');
  const part = digits.startsWith('0') ? digits.slice(1) : digits;
  return part.length >= 3 ? part : null;
}

/**
 * The ways a shop is found by one search word (§289), for the money pages.
 *
 * By what an admin has in front of them when they come looking: the shop's
 * name, its phone, the email of someone who runs it; where it is — a branch's
 * name, its street, its district or province; and, with `numbers`, any payout
 * number it has ever given (a statement names the number the money went to,
 * which may since have been replaced). Asked of the database, with the tab and
 * the paging, so a long list is never loaded to be filtered (§216).
 */
export function shopMatching(q: string, { numbers }: { numbers: boolean }): Prisma.BusinessProfileWhereInput[] {
  const word = { contains: q, mode: Prisma.QueryMode.insensitive };
  const digits = numberPart(q);
  return [
    { name: word },
    { members: { some: { status: BusinessMemberStatus.ACTIVE, user: { email: word } } } },
    {
      locations: {
        some: {
          OR: [
            { name: word },
            { address: word },
            { district: { name: word } },
            { district: { province: { name: word } } },
          ],
        },
      },
    },
    ...(digits ? [{ phone: { contains: digits } }, { locations: { some: { phone: { contains: digits } } } }] : []),
    ...(digits && numbers ? [{ payoutDestinations: { some: { msisdn: { contains: digits } } } }] : []),
  ];
}

/**
 * Where each shop is (§289): the districts of its open branches, or a
 * branch's own name where it has no district — so a card found by a place
 * shows the place it was found by.
 */
export async function placesOf(prisma: PrismaService, businessIds: string[]): Promise<Map<string, string[]>> {
  const places = new Map<string, string[]>();
  if (businessIds.length === 0) return places;
  const branches = await prisma.location.findMany({
    where: { businessId: { in: [...new Set(businessIds)] }, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { businessId: true, name: true, district: { select: { name: true } } },
  });
  for (const branch of branches) {
    const list = places.get(branch.businessId) ?? [];
    const place = branch.district?.name ?? branch.name;
    if (!list.includes(place)) list.push(place);
    places.set(branch.businessId, list);
  }
  return places;
}
