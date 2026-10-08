import { BadRequestException } from '@nestjs/common';

/**
 * The most one booking may ask for, whatever the branch. Only bounds the type
 * at the door: the real limit is the branch's places, checked below.
 */
export const MAX_QUANTITY = 1000;

/**
 * How many people one booking may be for (§189): as many as the branch serves
 * at once — its `capacity`, "People served at once" on the business's Hours
 * page. Nothing on the service limits it.
 *
 * A booking for three takes three of the branch's places for the service's own
 * length, so a branch serving five at once has two left at that time for
 * everyone else. A group larger than the branch can never fit, so it is
 * refused here with the number in the message, rather than offered no times.
 */
export function assertQuantityAllowed(quantity: number, capacity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new BadRequestException('quantity must be a whole number, 1 or more.');
  }
  if (quantity > capacity) {
    throw new BadRequestException(
      capacity === 1
        ? 'This branch serves one person at a time.'
        : `This branch serves at most ${capacity} people at once.`,
    );
  }
}
