import { Prisma } from '@prisma/client';

/**
 * Recomputes `Location.fromPriceMinor` for every location of one business.
 *
 * ONE statement, never a loop. Services are business-scoped (§10.2), so a single
 * service write changes the headline price of every branch that business owns —
 * a salon with six locations must not cost six updates, and a loop would also
 * leave the six briefly disagreeing with each other.
 *
 * Raw SQL because the new value is a correlated aggregate over another table,
 * which Prisma's `update` cannot express. The same judgement as the haversine in
 * §43.5: the aggregation stays in the database rather than being pulled into
 * application memory and written back.
 *
 * Takes a transaction client, because every caller has something else to commit
 * alongside it: a price that changed without the listing following it is a
 * listing that advertises a price nobody can book at.
 *
 * MIN over an empty set is NULL, which is exactly the meaning wanted — the
 * business has no active services — so no special case is needed for it.
 */
export function recalculateFromPrice(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "locations" l
       SET "fromPriceMinor" = (
         SELECT MIN(s."priceMinor")
           FROM "services" s
          WHERE s."businessId" = l."businessId"
            AND s."isActive" = true
       )
     WHERE l."businessId" = ${businessId}
  `;
}
