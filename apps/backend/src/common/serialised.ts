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

/** Strips null and undefined, so a nullable field is compared by its shape. */
type Defined<T> = Exclude<T, null | undefined>;

/**
 * Every field a DTO declares that its payload does not provide, at ANY depth —
 * returned as a union of the offending names (§128.17, §128.30).
 *
 * This exists because `implements` is only half a check: it requires the class
 * to have at least the payload's members and says nothing about members the
 * payload lacks. So a field dropped from a `select` leaves the DTO still
 * declaring it, the contract still promising it, and every client still typing
 * it — the shape of both the §109 and the §125 bug.
 *
 * It began as a top-level comparison, which was itself half a check: a class
 * with an extra property is still assignable to an interface without it, so
 * NESTED DTOs stayed open to the very bug this was written to stop. Going deep
 * immediately found `LocationHoursDto` and `LocationDistrictDto` publishing
 * four timestamp fields that exist on NEITHER model.
 *
 * Arrays are compared element-wise and nullable fields by their underlying
 * shape, so `Foo | null` is checked like `Foo`.
 */
export type ExtraFieldPaths<Dto, Wire> =
  Defined<Dto> extends readonly (infer DtoItem)[]
    ? Defined<Wire> extends readonly (infer WireItem)[]
      ? ExtraFieldPaths<DtoItem, WireItem>
      : never
    : Defined<Dto> extends object
      ? Defined<Wire> extends object
        ?
            | Exclude<keyof Defined<Dto>, keyof Defined<Wire>>
            | {
                [K in keyof Defined<Dto> & keyof Defined<Wire>]: ExtraFieldPaths<
                  Defined<Dto>[K],
                  Defined<Wire>[K]
                >;
              }[keyof Defined<Dto> & keyof Defined<Wire>]
        : never
      : never;

/**
 * Used BESIDE `implements`, never instead of it — together they pin the shape
 * from both sides:
 *
 *   export class FooDto implements FooWire {}
 *   export const __fooIsExact: NoExtraFields<FooDto, FooWire> = true;
 *
 * Proved by deleting fields and watching the build fail, at both depths. A
 * check not seen to fail is not known to work (§114.2).
 */
export type NoExtraFields<Dto, Wire> = [ExtraFieldPaths<Dto, Wire>] extends [
  never,
]
  ? true
  : {
      error: 'This DTO declares a field the query does not select';
      extraFields: ExtraFieldPaths<Dto, Wire>;
    };
