import { BadRequestException } from '@nestjs/common';
import { QuantityMode } from '@prisma/client';
import { MINUTES_PER_DAY } from '../availability/time.util';

/** The most any service may allow in one booking. */
export const MAX_QUANTITY = 1000;

export interface QuantityPlan {
  /** How long the whole booking takes. */
  durationMinutes: number;
  /** How many of the branch's places it occupies at once. */
  capacityUnits: number;
}

/**
 * What booking `quantity` of a service costs the branch in TIME and PLACES
 * (§136). The price is not here: it is always `quantity × unit price`.
 *
 * - SINGLE and UNITS: one customer in one place for the service's own length.
 *   Three passport photos are one sitting.
 * - PEOPLE: each person needs a place. They are served side by side for as
 *   many as the branch has places, and in ROUNDS after that:
 *
 *       places taken = min(people, capacity)
 *       rounds       = ceil(people / places taken)
 *       time         = rounds × the service's length
 *
 *   So three haircuts are 30 minutes in a four-chair salon, 60 minutes across
 *   two chairs, and 90 minutes back to back in a one-chair barbershop — and no
 *   business has to configure which. The alternative, refusing a group larger
 *   than the capacity, would make every one-chair shop unable to take a parent
 *   and a child in one booking.
 *
 * One function, called by availability AND by booking, so the slot a customer
 * is offered and the slot the server will accept cannot be computed two ways.
 */
export function planQuantity(
  mode: QuantityMode,
  quantity: number,
  capacity: number,
  durationMinutes: number,
): QuantityPlan {
  if (mode !== QuantityMode.PEOPLE || quantity <= 1) {
    return { durationMinutes, capacityUnits: 1 };
  }
  const capacityUnits = Math.max(1, Math.min(quantity, capacity));
  const rounds = Math.ceil(quantity / capacityUnits);
  return { durationMinutes: durationMinutes * rounds, capacityUnits };
}

/**
 * Refuses a quantity the service does not allow.
 *
 * A 400 with the limit in it, because the usual cause is honest: the business
 * lowered the maximum while the customer had the screen open.
 */
export function assertQuantityAllowed(
  service: { quantityMode: QuantityMode; maxQuantity: number },
  quantity: number,
): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new BadRequestException('quantity must be a whole number, 1 or more.');
  }
  const limit = service.quantityMode === QuantityMode.SINGLE ? 1 : service.maxQuantity;
  if (quantity > limit) {
    throw new BadRequestException(
      limit === 1
        ? 'This service is booked one at a time.'
        : `You can book at most ${limit} of this service at once.`,
    );
  }
}

/** A booking has to end the day it starts; a quantity that cannot is refused. */
export function assertFitsInADay(plan: QuantityPlan): void {
  if (plan.durationMinutes > MINUTES_PER_DAY) {
    throw new BadRequestException('That many will not fit in one day here.');
  }
}

/**
 * The two service columns, made to agree before they are written.
 *
 * SINGLE always stores a maximum of 1, whatever was sent beside it — a form
 * that hides the number field when "one per booking" is chosen still posts the
 * last value typed into it.
 */
export function normaliseQuantityRule(
  mode: QuantityMode,
  maxQuantity: number | undefined,
): { quantityMode: QuantityMode; maxQuantity: number } {
  if (mode === QuantityMode.SINGLE) return { quantityMode: mode, maxQuantity: 1 };
  if (maxQuantity === undefined || maxQuantity < 2 || maxQuantity > MAX_QUANTITY) {
    throw new BadRequestException(
      `maxQuantity must be between 2 and ${MAX_QUANTITY} when more than one can be booked.`,
    );
  }
  return { quantityMode: mode, maxQuantity };
}
