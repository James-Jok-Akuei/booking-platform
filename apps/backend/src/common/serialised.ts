import { Prisma } from '@prisma/client';

/**
 * What a Prisma payload looks like once it has been through JSON (§128.1).
 *
 * A response DTO describes the **wire**, not the row, and the two differ in two
 * places that have each already cost something here:
 *
 * * a `Date` arrives as an ISO string — `"2026-10-03T06:00:00.000Z"`;
 * * a `Decimal` arrives as a string too — `"15"`, not `15` — which is why
 *   `depositPercentage` is read and never multiplied (§56).
 *
 * Declaring `Prisma.Decimal` on a DTO also breaks the contract outright: it is a
 * class with no enumerable properties, so the generator emits a nameless empty
 * schema and refuses the whole document — which is how this was found.
 *
 * Used as `implements Serialised<Payload>`, so a DTO is checked against the real
 * `select` while still describing what a client actually receives. Changing the
 * select without changing the DTO fails the build; getting the wire type wrong
 * fails it too.
 */
export type Serialised<T> = T extends Date
  ? string
  : T extends Prisma.Decimal
    ? string
    : T extends (infer U)[]
      ? Serialised<U>[]
      : T extends object
        ? { [K in keyof T]: Serialised<T[K]> }
        : T;
