import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSignedIn } from './api/client';
import { followShop, listFollows, setFollowOffers, unfollowShop, type Follow } from './api/notifications';
import { showDialog } from './ui/Dialog';

/** "Kigali Barbers'", "Amani's" — a name already ending in s takes the mark alone. */
export const whose = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`);

/** The words a yes to a shop's offers agrees to, kept with it (§287). Said the same way by the server. */
export const followWords = (shop: string) => `Yes, send me ${whose(shop)} offers. I can stop at any time.`;

/** Everything this customer follows — one list, shared by every screen that asks. */
export function useFollows() {
  const signedIn = useSignedIn();
  return useQuery({ queryKey: ['follows'], queryFn: listFollows, enabled: signedIn, staleTime: 30_000 });
}

/**
 * Following one shop (§288). Following brings its news into the app — its
 * discounts, new services, stories and messages, under Saved → Following.
 * Its offers as notifications are a separate yes, asked in plain words the
 * moment someone follows. Signed out, a tap goes to sign in first.
 */
export function useFollow(businessId: string | undefined, shopName = 'this shop') {
  const signedIn = useSignedIn();
  const router = useRouter();
  const queryClient = useQueryClient();
  const follows = useFollows();
  const mine: Follow | undefined = businessId ? follows.data?.follows.find((f) => f.business.id === businessId) : undefined;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['follows'] });

  const follow = useMutation({ mutationFn: (offers: boolean) => followShop(businessId!, offers), onSettled: refresh });
  const offers = useMutation({ mutationFn: (on: boolean) => setFollowOffers(businessId!, on), onSettled: refresh });
  const unfollow = useMutation({ mutationFn: () => unfollowShop(businessId!), onSettled: refresh });
  const pending = follow.isPending || offers.isPending || unfollow.isPending;

  const following = unfollow.isPending ? false : follow.isPending ? true : Boolean(mine);
  const offersOn = offers.isPending ? Boolean(offers.variables) : follow.isPending ? Boolean(follow.variables) : Boolean(mine?.offers);

  return {
    following,
    offers: offersOn,
    pending,
    /** Follow, asking about offers in the same breath; or unfollow. */
    toggle: () => {
      if (!businessId) return;
      if (!signedIn) {
        router.push('/sign-in');
        return;
      }
      if (following) {
        unfollow.mutate();
        return;
      }
      showDialog({
        title: `Follow ${shopName}?`,
        message:
          `Its new services, discounts and stories come together for you under Saved → Following.\n\n` +
          `Do you also want its offers as notifications — one a week at most? “${followWords(shopName)}”`,
        tone: 'accent',
        icon: 'heart',
        actions: [
          { label: 'Follow, and send me offers', role: 'primary', onPress: () => follow.mutate(true) },
          { label: 'Just follow', role: 'secondary', onPress: () => follow.mutate(false) },
          { label: 'Not now', role: 'cancel' },
        ],
      });
    },
    /** Follow straight away — from a screen that has already said what it means. */
    follow: (withOffers: boolean) => {
      if (!businessId) return;
      if (!signedIn) {
        router.push('/sign-in');
        return;
      }
      if (following) offers.mutate(withOffers);
      else follow.mutate(withOffers);
    },
    setOffers: (on: boolean) => {
      if (businessId) offers.mutate(on);
    },
    unfollow: () => {
      if (businessId) unfollow.mutate();
    },
  };
}
