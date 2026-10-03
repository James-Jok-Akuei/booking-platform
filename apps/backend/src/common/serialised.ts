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

/**
 * Asserts a DTO claims NO field its query does not select (§128.17).
 *
 * `implements` is only half a check. It requires the class to have at least the
 * payload's members, and says nothing about members the payload does not have —
 * so a field DROPPED from a `select` leaves the DTO still advertising it, the
 * contract still promising it, and the clients still typing it. That is the
 * §109 bug and the §125 bug, both of which were a response missing a field its
 * own published type claimed.
 *
 * Proved by deleting `imageUrl` from `ME_SELECT`: the build stayed green and
 * `GET /users/me` went on promising a picture it no longer returned.
 *
 * Used beside `implements`, never instead of it — together they pin the shape
 * from both sides:
 *
 *   export class FooDto implements FooWire {}
 *   export const __fooIsExact: NoExtraFields<FooDto, FooWire> = true;
 */
export type NoExtraFields<Dto, Wire> = [Exclude<keyof Dto, keyof Wire>] extends [
  never,
]
  ? true
  : {
      error: 'This DTO declares a field the query does not select';
      extraFields: Exclude<keyof Dto, keyof Wire>;
    };
