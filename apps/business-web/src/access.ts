import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMe, type BusinessMembership } from './api/business';

/**
 * What the signed-in person may do here, and where (§277) — the server's rules,
 * said once so every screen agrees.
 *
 * The ROLE says what: the owner runs everything; a manager runs their
 * branches; staff work the front desk. The BRANCHES say where: the owner, and
 * anyone given every branch, sees the whole business; everyone else sees only
 * the branches the owner chose for them.
 *
 * A convenience, never an authority: the server decides every request. This
 * only keeps a screen from offering a button whose answer would be "no".
 */
export type Access = {
  /** False until we know who this is; screens treat that as the owner, so nothing flickers away for most people. */
  ready: boolean;
  role: BusinessMembership['role'] | null;
  /** Every branch, including ones added later. */
  allBranches: boolean;
  /** The chosen branches, when not every one. */
  branchIds: string[];
  isOwner: boolean;
  /** Runs their branches: hours, closures, branch photos, which services their branch offers. */
  runsBranches: boolean;
  /** Changes the whole business: shopfront, service catalogue and prices, adding or closing branches, posting. */
  runsBusiness: boolean;
  /** Sees the balance, payouts and the payout number's state. */
  money: boolean;
  /** Sees how the business is going. */
  insights: boolean;
  /** Cancels bookings (which refunds the customer). */
  cancels: boolean;
  /** Adds and removes people and chooses their branches. */
  people: boolean;
  /** Pauses and resumes the whole shop. */
  pauses: boolean;
  /** Whether a branch is one of theirs. */
  sees: (locationId: string) => boolean;
};

export function accessOf(membership: BusinessMembership | null | undefined, ready = true): Access {
  const role = membership?.role ?? (ready ? null : 'OWNER');
  const isOwner = role === 'OWNER';
  const manager = isOwner || role === 'MANAGER';
  const allBranches = isOwner || (membership?.allLocations ?? !ready);
  const branchIds = allBranches ? [] : (membership?.locationIds ?? []);
  return {
    ready,
    role,
    allBranches,
    branchIds,
    isOwner,
    runsBranches: manager,
    runsBusiness: manager && allBranches,
    money: manager && allBranches,
    insights: manager,
    cancels: manager,
    people: isOwner,
    pauses: isOwner,
    sees: (id) => allBranches || branchIds.includes(id),
  };
}

/** The signed-in person's access, from the same 'me' every screen already asks for. */
export function useAccess(): Access {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const membership = me.data?.businessMembership;
  return useMemo(() => accessOf(membership, me.isSuccess), [membership, me.isSuccess]);
}
