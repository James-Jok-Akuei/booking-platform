import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSignedIn } from './api/client';
import { followShop, listFollows, unfollowShop } from './api/notifications';

/** The words a follow agrees to, kept with the yes (§287). */
export const followWords = (shop: string) => `Yes, send me ${shop}'s offers. I can stop at any time.`;

/**
 * Following a shop (§287): the yes to its offers, one tap either way. Signed
 * out, the tap goes to sign in first.
 */
export function useFollow(businessId: string | undefined) {
  const signedIn = useSignedIn();
  const router = useRouter();
  const queryClient = useQueryClient();
  const follows = useQuery({ queryKey: ['follows'], queryFn: listFollows, enabled: signedIn });
  const following = Boolean(businessId && follows.data?.follows.some((f) => f.business.id === businessId));
  const change = useMutation({
    mutationFn: (on: boolean) => (on ? followShop(businessId!) : unfollowShop(businessId!)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['follows'] }),
  });
  return {
    following: change.isPending ? Boolean(change.variables) : following,
    pending: change.isPending,
    toggle: () => {
      if (!businessId) return;
      if (!signedIn) {
        router.push('/sign-in');
        return;
      }
      change.mutate(!following);
    },
  };
}
