import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listSavedServices, type SavedService } from '../../src/api/discovery';
import { useSignedIn } from '../../src/api/client';
import {
  followShop,
  setFollowOffers,
  unfollowShop,
  type Follow,
  type FollowNews,
} from '../../src/api/notifications';
import { followWords, useFollows, whose } from '../../src/useFollow';
import { useSavedService } from '../../src/useSavedService';
import { FollowingCard } from '../../src/components/FollowingCard';
import { SavedServiceCard } from '../../src/components/SavedServiceCard';
import { useMoney } from '../../src/money';
import { radius, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { showDialog, showProblem } from '../../src/ui/Dialog';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { Segmented } from '../../src/ui/Segmented';
import { PlaceCardSkeleton } from '../../src/ui/Skeleton';
import { BigTitle } from '../../src/ui/TopBar';
import { Undo } from '../../src/ui/Undo';

type Kind = 'following' | 'services';
type FollowList = { follows: Follow[] };

/**
 * The shops you follow and the services you saved (§120, §158, §288).
 *
 * Not a cart, and the screen says so by what it does not have: no total, no
 * checkout, no quantity. Saving reserves nothing — a slot is held by booking it,
 * and a basket that held slots would take them from somebody ready to book.
 *
 * Two lists under one heading, switched rather than mixed: a shop and a haircut
 * are different kinds of thing. A shop is followed rather than saved (§288) —
 * one heart, one idea — and following brings what is new there onto its card:
 * a discount on now, a service just added, this week's message.
 */
export default function Saved() {
  const router = useRouter();
  const money = useMoney();
  const queryClient = useQueryClient();
  const savedService = useSavedService();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();
  const [kind, setKind] = useState<Kind>('following');
  const [undo, setUndo] = useState<{ follow: Follow; token: number } | null>(null);

  const follows = useFollows();
  const services = useQuery({
    queryKey: ['saved-services'],
    queryFn: listSavedServices,
    enabled: signedIn,
  });

  // Written into the list straight away, like the heart (§120.2): a switch
  // that waits for a round trip feels broken.
  const patch = (change: (rows: Follow[]) => Follow[]) =>
    queryClient.setQueryData<FollowList>(['follows'], (list) => (list ? { ...list, follows: change(list.follows) } : list));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['follows'] });

  const offers = useMutation({
    mutationFn: ({ follow, on }: { follow: Follow; on: boolean }) => setFollowOffers(follow.business.id, on),
    onMutate: ({ follow, on }) =>
      patch((rows) => rows.map((r) => (r.business.id === follow.business.id ? { ...r, offers: on } : r))),
    onError: (error) => showProblem('Not changed', error),
    onSettled: refresh,
  });
  const unfollow = useMutation({
    mutationFn: (follow: Follow) => unfollowShop(follow.business.id),
    onMutate: (follow) => {
      patch((rows) => rows.filter((r) => r.business.id !== follow.business.id));
      setUndo({ follow, token: Date.now() });
    },
    onError: (error) => {
      setUndo(null);
      showProblem('Still following', error);
    },
    onSettled: refresh,
  });
  // Undo puts back exactly what was there, the yes to offers included.
  const refollow = useMutation({
    mutationFn: (follow: Follow) => followShop(follow.business.id, follow.offers),
    onError: (error) => showProblem('Not followed', error),
    onSettled: refresh,
  });

  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <BigTitle title="Saved" />
        <EmptyState
          icon="heart-outline"
          title="Sign in to keep a list"
          text="Shops you follow and services you save are kept with your account, so they follow you to any phone."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/saved')}
        />
      </View>
    );
  }

  const followRows = follows.data?.follows ?? [];
  const serviceRows = services.data?.services ?? [];
  const active = kind === 'following' ? follows : services;
  const removed = services.data?.removed ?? 0;

  const count = (n: number | undefined) => (n === undefined ? '' : ` · ${n}`);

  const openShop = (follow: Follow) => follow.bookAt && router.push(`/shop/${follow.bookAt.id}`);
  const openNews = (follow: Follow, news: FollowNews) => {
    if (!follow.bookAt) return;
    if (news.serviceId) router.push(`/book/${follow.bookAt.id}?serviceId=${news.serviceId}`);
    else router.push(`/shop/${follow.bookAt.id}`);
  };
  const toggleOffers = (follow: Follow) => {
    if (follow.offers) {
      offers.mutate({ follow, on: false });
      return;
    }
    // A yes to marketing is asked in its own words, every time (§287).
    showDialog({
      title: `Hear ${whose(follow.business.name)} offers?`,
      message: `“${followWords(follow.business.name)}”\n\nOne a week at most, as a phone alert or an email — whichever you allow under Notifications.`,
      tone: 'accent',
      icon: 'notifications',
      actions: [
        { label: 'Yes, send them', role: 'primary', onPress: () => offers.mutate({ follow, on: true }) },
        { label: 'Not now', role: 'cancel' },
      ],
    });
  };

  const header = (
    <View style={styles.header}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'following', label: `Following${count(follows.data?.follows.length)}` },
          { value: 'services', label: `Services${count(services.data?.total)}` },
        ]}
      />
      {/* Said once, on the read that found them gone (§158): a list that is
          shorter than it was should say why. */}
      {kind === 'services' && removed > 0 && (
        <FadeIn style={styles.removed}>
          <Icon name="information-circle-outline" size={16} color={theme.ink2} />
          <Text style={[type.small, styles.flex]}>
            {removed === 1
              ? 'One saved service is no longer offered and was taken off your list.'
              : `${removed} saved services are no longer offered and were taken off your list.`}
          </Text>
        </FadeIn>
      )}
    </View>
  );

  const empty = active.isLoading ? (
    <View style={styles.skeletons}>
      <PlaceCardSkeleton />
      <PlaceCardSkeleton />
    </View>
  ) : kind === 'following' ? (
    <EmptyState
      icon="heart-outline"
      title="Not following anyone yet"
      text="Tap Follow on a shop's page. Its new services, discounts and stories then come together here."
      action="Find a place"
      onAction={() => router.push('/')}
    />
  ) : (
    <EmptyState
      icon="heart-outline"
      title="No services saved yet"
      text="Tap the heart on any service — on Home or on a shop's page — and it will wait for you here."
      action="Browse services"
      onAction={() => router.push('/')}
    />
  );

  // A new list when the columns change (FlatList cannot change them in place).
  // The key goes on the list itself: React does not take one inside a spread.
  const listKey = `${kind}-${layout.columns}`;
  const listProps = {
    numColumns: layout.columns,
    showsVerticalScrollIndicator: false,
    contentContainerStyle: [
      styles.list,
      {
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
        width: layout.contentWidth,
        paddingHorizontal: layout.gutter,
      },
    ],
    columnWrapperStyle: layout.columns > 1 ? styles.columns : undefined,
    refreshControl: (
      <RefreshControl
        refreshing={active.isRefetching}
        onRefresh={() => active.refetch()}
        tintColor={theme.accent}
        colors={[theme.accent]}
      />
    ),
    ListHeaderComponent: header,
    ListEmptyComponent: empty,
  };

  return (
    <View style={styles.screen}>
      <BigTitle title="Saved" />
      {kind === 'following' ? (
        <FlatList
          key={listKey}
          {...listProps}
          data={followRows}
          keyExtractor={(item) => item.business.id}
          renderItem={({ item, index }: { item: Follow; index: number }) => (
            <FadeIn index={index}>
              <FollowingCard
                follow={item}
                width={layout.columns > 1 ? layout.cardWidth : undefined}
                onOpen={() => openShop(item)}
                onNews={(news) => openNews(item, news)}
                onOffers={() => toggleOffers(item)}
                onUnfollow={() => unfollow.mutate(item)}
              />
            </FadeIn>
          )}
        />
      ) : (
        <FlatList
          key={listKey}
          {...listProps}
          data={serviceRows}
          keyExtractor={(item) => `${item.id}:${item.location.id}`}
          renderItem={({ item, index }: { item: SavedService; index: number }) => (
            <FadeIn index={index}>
              <SavedServiceCard
                service={item}
                price={money.format(item.priceMinor, item.currency)}
                width={layout.columns > 1 ? layout.cardWidth : undefined}
                onPress={() => router.push(`/book/${item.location.id}?serviceId=${item.id}`)}
                onShop={() => router.push(`/shop/${item.location.id}`)}
                onSave={() => savedService.toggle(item.id, item.location.id, true, '/saved')}
              />
            </FadeIn>
          )}
        />
      )}

      <Undo
        message={undo ? `Unfollowed ${undo.follow.business.name}` : null}
        token={undo?.token ?? 0}
        onUndo={() => {
          if (!undo) return;
          refollow.mutate(undo.follow);
          setUndo(null);
        }}
        onExpire={() => setUndo(null)}
        icon="heart-dislike-outline"
        lift={TAB_BAR_CLEARANCE - 24}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  header: { gap: 12, paddingTop: 2, paddingBottom: 4 },
  removed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.panel,
    borderRadius: radius.md,
    padding: 12,
  },
  list: { paddingTop: 6, gap: 16, alignSelf: 'center' },
  columns: { gap: 14 },
  skeletons: { gap: 16 },
});
