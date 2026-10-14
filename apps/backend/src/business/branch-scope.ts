import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BusinessMemberRole, Prisma } from '@prisma/client';

/**
 * Which branches a member looks after (§277).
 *
 * Access inside a business is two things, not one: the ROLE says what a person
 * may do (§14.2), the SCOPE says where. The owner — and anyone the owner gives
 * "every branch" — sees the whole business, including branches added later;
 * anyone else sees, and acts on, only the branches the owner chose for them.
 * Nothing at another branch exists for them: its bookings, messages, reviews,
 * closures and photos are not shown and cannot be reached by id.
 */
export interface BranchScope {
  /** Every branch, including ones added later. */
  allLocations: boolean;
  /** The chosen branches, when not every one. Empty when `allLocations`. */
  locationIds: string[];
}

export const EVERY_BRANCH: BranchScope = { allLocations: true, locationIds: [] };

/** What a membership read needs, to know its scope. */
export const MEMBERSHIP_SCOPE_SELECT = {
  role: true,
  allLocations: true,
  locations: { select: { locationId: true } },
} satisfies Prisma.BusinessMembershipSelect;

/** A membership's scope. The OWNER always looks after every branch. */
export function scopeOf(membership: {
  role: BusinessMemberRole;
  allLocations: boolean;
  locations: Array<{ locationId: string }>;
}): BranchScope {
  if (membership.role === BusinessMemberRole.OWNER || membership.allLocations) return EVERY_BRANCH;
  return { allLocations: false, locationIds: membership.locations.map((l) => l.locationId) };
}

export const seesBranch = (scope: BranchScope, locationId: string) =>
  scope.allLocations || scope.locationIds.includes(locationId);

/**
 * A filter for a `locationId` column: nothing when every branch is theirs,
 * `{ in: [...] }` otherwise. Spread it only where it is defined:
 * `...(branchIn(scope) && { locationId: branchIn(scope) })`.
 */
export const branchIn = (scope: BranchScope): { in: string[] } | undefined =>
  scope.allLocations ? undefined : { in: scope.locationIds };

/**
 * A branch outside the member's scope is "not found" — the same answer as
 * another business's branch (§10.7): saying it exists is already telling.
 */
export function assertBranch(scope: BranchScope, locationId: string) {
  if (!seesBranch(scope, locationId)) throw new NotFoundException('Location not found.');
}

export const ALL_BRANCHES_ONLY =
  'This changes the whole business, so only the owner or someone who looks after every branch can do it.';

/** Changes to the whole business — its shopfront, its catalogue, its branches — need every branch. */
export function assertAllBranches(scope: BranchScope) {
  if (!scope.allLocations) throw new ForbiddenException(ALL_BRANCHES_ONLY);
}

/**
 * A `where` on memberships for the people who look after one branch (§277):
 * the owner, everyone given every branch, and those given this one. With no
 * branch (a question to the whole business), the owner and every-branch members.
 */
export function membersOfBranch(locationId: string | null | undefined): Prisma.BusinessMembershipWhereInput {
  const everyBranch: Prisma.BusinessMembershipWhereInput[] = [
    { role: BusinessMemberRole.OWNER },
    { allLocations: true },
  ];
  return { OR: locationId ? [...everyBranch, { locations: { some: { locationId } } }] : everyBranch };
}

export const MONEY_READERS_ONLY =
  'The business’s money is for the owner, and for managers who look after every branch.';

/**
 * Who may see the business's money — its balance, payouts and payout number
 * (§277): the owner, and a manager who looks after every branch. The money is
 * the whole business's, so a manager of some branches would be reading the
 * others' takings; and the front desk does not need it.
 */
export const mayReadMoney = (role: BusinessMemberRole, scope: BranchScope) =>
  role === BusinessMemberRole.OWNER || (role === BusinessMemberRole.MANAGER && scope.allLocations);

/** The same rule as `mayReadMoney`, as a `where` on memberships. */
export const MONEY_READERS: Prisma.BusinessMembershipWhereInput = {
  OR: [{ role: BusinessMemberRole.OWNER }, { role: BusinessMemberRole.MANAGER, allLocations: true }],
};
