import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSignedIn } from './api/client';
import { followShop, listFollows, setFollowOffers, unfollowShop, type Follow } from './api/notifications';
import { showDialog } from './ui/Dialog';
import { t } from '@lingui/core/macro';

/**
 * The words a yes to a shop's offers agrees to, kept with it (§287). Said the
 * same way by the server. "Offers from {shop}" rather than "{shop}'s offers":
 * a possessive built in English code cannot be translated (§308).
 */
export const followWords = (shop: string) => t`Yes, send me offers from ${shop}. I can stop at any time.`;

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
export function useFollow(businessId: string | undefined, shopName = t`this shop`) {
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
      // Why it is worth it, said before the choice — following is only kept
      // if it gives something back (§288).
      showDialog({
        title: t`Follow ${shopName}?`,
        message: t`You will not miss a thing from them:`,
        points: [
          { icon: 'pricetag', text: t`Its discounts as they start` },
          { icon: 'sparkles', text: t`New services as they are added` },
          { icon: 'home', text: t`A row of its services on Home` },
          { icon: 'aperture', text: t`Its stories first` },
          { icon: 'heart', text: t`All of it in Saved → Following` },
        ],
        note: t`Offers as alerts or emails are a separate yes, one a week at most: “${followWords(shopName)}”`,
        tone: 'accent',
        icon: 'heart',
        actions: [
          { label: t`Follow, and send me offers`, role: 'primary', onPress: () => follow.mutate(true) },
          { label: t`Just follow`, role: 'secondary', onPress: () => follow.mutate(false) },
          { label: t`Not now`, role: 'cancel' },
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
