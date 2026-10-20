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
 * MIN over an empty set is NULL, which is exactly the meaning wanted — this
 * BRANCH offers nothing bookable — so no special case is needed for it.
 *
 * Since §72 the cheapest price is per branch, not per business: the join is
 * on `service_locations.locationId`, so two branches of one chain can and do
 * advertise different headline prices. The update still runs over every
 * location of the business in one statement, because one service write can
 * change several branches at once.
 *
 * Since §300 a service's cheapest price includes the cheapest available
 * answer to each question that must be answered and always shows — a car
 * wash whose every size costs extra is not bookable at the bare price, so
 * the branch must not advertise it. Never below nothing: an answer can take
 * money off.
 */
export function recalculateFromPrice(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "locations" l
       SET "fromPriceMinor" = (
         SELECT MIN(GREATEST(0, sl."priceMinor" + COALESCE((
                  SELECT SUM(cheapest."priceMinor")
                    FROM (
                      SELECT MIN(o."priceMinor") AS "priceMinor"
                        FROM "service_choice_groups" g
                        JOIN "service_choice_options" o
                          ON o."groupId" = g."id" AND o."available" = true
                       WHERE g."serviceId" = s."id"
                         AND g."required" = true
                         AND g."showIfOptionId" IS NULL
                       GROUP BY g."id"
                    ) cheapest
                ), 0)))
           FROM "service_locations" sl
           JOIN "services" s ON s."id" = sl."serviceId"
          WHERE sl."locationId" = l."id"
            AND sl."isOffered" = true
            AND s."isActive" = true
       )
     WHERE l."businessId" = ${businessId}
  `;
}
