import { useQuery } from '@tanstack/react-query';
import { getMyAccess } from '../api/admin';

/**
 * What the signed-in administrator may see (§317). Money access — the
 * statistics, the money book, payouts and payout numbers, the fee and rate
 * settings, the Overview's money — is the primary administrator's, and theirs
 * to give. Read from the server, which enforces it on every request; this
 * only decides what the console offers. Asked again when the window comes
 * back, so access given or taken shows without signing in again.
 */
export function useMyAccess() {
  const access = useQuery({ queryKey: ['my-access'], queryFn: getMyAccess, staleTime: 60_000, refetchOnWindowFocus: true });
  return {
    known: access.isSuccess,
    money: access.data?.moneyAccess ?? false,
    primary: access.data?.isPrimaryAdmin ?? false,
  };
}
