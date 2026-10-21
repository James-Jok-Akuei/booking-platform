import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, useSignedIn } from '../api/client';
import { reportStory, viewStory, type StoryShop } from '../api/stories';
import { ago } from '../components/NotificationCard';
import { font, radius, theme } from '../theme';
import { Avatar } from '../ui/Avatar';
import { tick } from '../ui/haptic';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { firstUnseen, markSeen, useSeenStories } from './seen';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/** How long a photo stays up once it has loaded, before the next one. */
const SHOW_MS = 5000;

/** Wider than this, the story plays in a phone-shaped frame in the middle. */
const WIDE = 640;

/** Stories counted in this sitting: going back to one is not a second view. */
const counted = new Set<string>();

/** Why a story is reported, in the app's language — read when the sheet opens (§308). */
const reasons = () => [t`It is misleading or not real`, t`It is rude or offensive`, t`It is spam`, t`Something else`];

export type StoryStart = { shop: number; story: number };

/**
 * A shop's stories, full screen (§285) — the way every app with stories plays
 * them, so nobody has to learn it: bars along the top fill as each photo's five
 * seconds pass; a tap on the right goes on, on the left goes back; holding
 * pauses and clears the words away; a swipe sideways skips to the next shop,
 * and down closes. When a shop's stories end, the next shop's begin.
 *
 * Every story ends in a Book button for the branch it is about, because the
 * point of a story is a booking.
 *
 * The clock only runs once the photo has arrived, so a slow connection never
 * skips a photo nobody saw. A view is counted then too, once per story.
 */
export function StoryPlayer({
  shops,
  openAt,
  onClose,
  onBook,
}: {
  shops: StoryShop[];
  /** Where to begin; `null` is closed. */
  openAt: StoryStart | null;
  onClose: () => void;
  /** Book at this branch: the player has already closed. */
  onBook: (locationId: string) => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signedIn = useSignedIn();
  const seen = useSeenStories();

  // Held still while it plays: the row behind reorders itself as stories are seen.
  const [list, setList] = useState<StoryShop[]>([]);
  const [at, setAt] = useState<StoryStart | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reporting, setReporting] = useState<'menu' | 'sent' | null>(null);

  const progress = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const swap = useRef(new Animated.Value(1)).current;
  const chrome = useRef(new Animated.Value(1)).current;
  const panel = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  const shop = at ? list[at.shop] : undefined;
  const story = shop && at ? shop.stories[at.story] : undefined;
  // "5 min", "3 h" — said as "{since} ago" in the app's language (§308).
  const since = story ? ago(story.createdAt) : '';

  const go = (next: StoryStart, newShop = false) => {
    progress.stopAnimation();
    progress.setValue(0);
    setLoaded(false);
    setBroken(false);
    setAt(next);
    if (newShop) {
      swap.setValue(0);
      Animated.spring(swap, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 4 }).start();
    }
  };

  useEffect(() => {
    if (!openAt) return;
    closing.current = false;
    setList(shops);
    setReporting(null);
    setHeld(false);
    setHidden(false);
    drag.setValue(0);
    open.setValue(0);
    go(openAt);
    tick();
    Animated.spring(open, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 4 }).start();
    // Only as it opens: the list changing behind an open player must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    progress.stopAnimation();
    Animated.timing(open, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setAt(null);
      onClose();
      then?.();
    });
  };

  const startOf = (index: number) => firstUnseen(seen, list[index]);
  const next = () => {
    if (!at || !shop) return;
    if (at.story < shop.stories.length - 1) go({ shop: at.shop, story: at.story + 1 });
    else if (at.shop < list.length - 1) go({ shop: at.shop + 1, story: startOf(at.shop + 1) }, true);
    else close();
  };
  const prev = () => {
    if (!at) return;
    if (at.story > 0) go({ shop: at.shop, story: at.story - 1 });
    else if (at.shop > 0) go({ shop: at.shop - 1, story: 0 }, true);
    else go({ shop: at.shop, story: 0 });
  };
  const nextShop = () => {
    if (at && at.shop < list.length - 1) go({ shop: at.shop + 1, story: startOf(at.shop + 1) }, true);
    else close();
  };
  const prevShop = () => {
    if (at && at.shop > 0) go({ shop: at.shop - 1, story: startOf(at.shop - 1) }, true);
  };
  // The timer and the drag are set up once; these keep them calling the latest.
  const moves = useRef({ next, nextShop, prevShop, close });
  moves.current = { next, nextShop, prevShop, close };

  // The clock: runs while the photo is in and nobody is holding or reporting.
  const paused = !loaded || held || reporting !== null || !story;
  useEffect(() => {
    if (paused) return;
    let live = true;
    progress.stopAnimation((from) => {
      if (!live) return;
      Animated.timing(progress, {
        toValue: 1,
        duration: Math.max(0, SHOW_MS * (1 - from)),
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && live) moves.current.next();
      });
    });
    return () => {
      live = false;
      progress.stopAnimation();
    };
  }, [paused, at?.shop, at?.story, progress]);

  // Seen, and counted, once the photo is actually showing.
  useEffect(() => {
    if (!loaded || !story || !shop) return;
    markSeen(shop.business.id, story);
    if (!counted.has(story.id)) {
      counted.add(story.id);
      viewStory(story.id).catch(() => undefined);
    }
  }, [loaded, story, shop]);

  // The next photo starts on its way while this one plays.
  useEffect(() => {
    if (!at || !shop) return;
    const after = shop.stories[at.story + 1] ?? list[at.shop + 1]?.stories[startOf(at.shop + 1)];
    if (after) Image.prefetch(after.imageUrl).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, shop, list]);

  useEffect(() => {
    Animated.timing(chrome, {
      toValue: hidden ? 0 : 1,
      duration: hidden ? 160 : 220,
      useNativeDriver: true,
    }).start();
  }, [hidden, chrome]);

  useEffect(() => {
    Animated.spring(panel, {
      toValue: reporting ? 1 : 0,
      useNativeDriver: true,
      speed: 16,
      bounciness: 3,
    }).start();
  }, [reporting, panel]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 || g.dy > 12,
        onPanResponderGrant: () => setHeld(true),
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0 && g.dy > Math.abs(g.dx)) drag.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          setHeld(false);
          const down = g.dy > Math.abs(g.dx);
          if (down && (g.dy > 110 || g.vy > 0.9)) {
            moves.current.close();
            return;
          }
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
          if (!down && Math.abs(g.dx) > 60) (g.dx < 0 ? moves.current.nextShop : moves.current.prevShop)();
        },
        onPanResponderTerminate: () => {
          setHeld(false);
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [drag],
  );

  const report = useMutation({
    mutationFn: (input: { id: string; reason: string }) => reportStory(input.id, input.reason),
    onSuccess: () => setReporting('sent'),
  });

  const wide = W > WIDE;
  const stageW = wide ? Math.min(W - 160, Math.round(((H - 48) * 9) / 16)) : W;
  const stageH = wide ? H - 48 : H;
  const top = wide ? 14 : insets.top + 8;
  const bottom = wide ? 18 : insets.bottom + 14;

  const onTap = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX;
    if (x < stageW * 0.3) prev();
    else next();
  };

  const pulled = {
    transform: [
      { translateY: drag },
      { scale: drag.interpolate({ inputRange: [0, H], outputRange: [1, 0.6], extrapolate: 'clamp' }) },
    ],
  };
  const stage = {
    opacity: Animated.multiply(open, swap.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] })),
    transform: [
      { scale: open.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
      { scale: swap.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };
  const dim = Animated.multiply(
    open,
    drag.interpolate({ inputRange: [0, H * 0.6], outputRange: [1, 0], extrapolate: 'clamp' }),
  );

  return (
    <Modal
      visible={openAt !== null}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => close()}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: dim }]} />

      <View style={styles.center}>
        {wide && <Arrow icon="chevron-back" label={t`The shop before`} onPress={prevShop} hidden={!at || at.shop === 0} />}

        <Animated.View style={pulled} {...pan.panHandlers}>
          <Animated.View style={[styles.stage, { width: stageW, height: stageH }, wide && styles.stageWide, stage]}>
            {story && shop && at && (
              <>
                <Image
                  key={`blur-${story.id}`}
                  source={{ uri: story.imageUrl }}
                  blurRadius={36}
                  resizeMode="cover"
                  style={[StyleSheet.absoluteFill, styles.blur]}
                />
                <View style={[StyleSheet.absoluteFill, styles.shade]} />
                <Image
                  key={story.id}
                  source={{ uri: story.imageUrl }}
                  resizeMode="contain"
                  style={StyleSheet.absoluteFill}
                  onLoad={() => setLoaded(true)}
                  onError={() => {
                    setBroken(true);
                    setLoaded(true);
                  }}
                  accessibilityLabel={story.caption ?? t`A story from ${shop.business.name}`}
                />
                {!loaded && <ActivityIndicator color="#FFFFFF" size="large" style={styles.spinner} />}
                {broken && (
                  <View style={styles.brokenBox} pointerEvents="none">
                    <Icon name="image-outline" size={30} color="rgba(255,255,255,0.7)" />
                    <Text style={styles.brokenText}><Trans>This photo did not load.</Trans></Text>
                  </View>
                )}

                <LinearGradient
                  colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
                  style={[styles.fadeTop, { height: top + 110 }]}
                  pointerEvents="none"
                />
                <LinearGradient
                  colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']}
                  style={[styles.fadeBottom, { height: bottom + 200 }]}
                  pointerEvents="none"
                />

                {/* Tap the right to go on, the left to go back; hold to pause. */}
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPressIn={() => setHeld(true)}
                  onPressOut={() => {
                    setHeld(false);
                    setHidden(false);
                  }}
                  onLongPress={() => setHidden(true)}
                  delayLongPress={260}
                  onPress={onTap}
                  accessibilityRole="button"
                  accessibilityLabel={t`Next story`}
                  accessibilityHint={t`Tap the left side to go back. Hold to pause.`}
                />

                <Animated.View style={[styles.head, { paddingTop: top, opacity: chrome }]} pointerEvents="box-none">
                  <View style={styles.bars} pointerEvents="none">
                    {shop.stories.map((s, i) => (
                      <View key={s.id} style={styles.bar}>
                        <Animated.View
                          style={[
                            styles.barFill,
                            {
                              width:
                                i < at.story
                                  ? '100%'
                                  : i > at.story
                                    ? '0%'
                                    : progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                            },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                  <View style={styles.who}>
                    <View style={styles.logo}>
                      <Avatar uri={shop.business.logoUrl} name={shop.business.name} size={34} />
                    </View>
                    <View style={styles.whoText}>
                      <Text style={styles.shopName} numberOfLines={1}>
                        {shop.business.name}
                      </Text>
                      <Text style={styles.when} numberOfLines={1}>
                        {Date.now() - new Date(story.createdAt).getTime() < 60_000 ? t`Just now` : t`${since} ago`}
                      </Text>
                    </View>
                    <PressableScale
                      onPress={() => {
                        report.reset();
                        setReporting('menu');
                      }}
                      hitSlop={8}
                      style={styles.headButton}
                      accessibilityRole="button"
                      accessibilityLabel={t`Report this story`}
                    >
                      <Icon name="ellipsis-horizontal" size={20} color="#FFFFFF" />
                    </PressableScale>
                    <PressableScale
                      onPress={() => close()}
                      hitSlop={8}
                      style={styles.headButton}
                      accessibilityRole="button"
                      accessibilityLabel={t`Close`}
                    >
                      <Icon name="close" size={24} color="#FFFFFF" />
                    </PressableScale>
                  </View>
                </Animated.View>

                <Animated.View
                  style={[styles.foot, { paddingBottom: bottom, opacity: chrome }]}
                  pointerEvents="box-none"
                >
                  {story.caption ? <Text style={styles.caption}>{story.caption}</Text> : null}
                  <PressableScale
                    onPress={() => close(() => onBook(story.bookAt.id))}
                    haptic
                    scaleTo={0.96}
                    style={styles.book}
                    accessibilityRole="button"
                    accessibilityLabel={t`Book at ${story.bookAt.name}`}
                  >
                    <Icon name="calendar" size={17} color={theme.ink} />
                    <Text style={styles.bookText} numberOfLines={1}><Trans>Book at {story.bookAt.name}</Trans>
                    </Text>
                    <Icon name="arrow-forward" size={16} color={theme.accentDeep} />
                  </PressableScale>
                </Animated.View>
              </>
            )}
          </Animated.View>
        </Animated.View>

        {wide && <Arrow icon="chevron-forward" label={t`The next shop`} onPress={nextShop} hidden={!at} />}
      </View>

      {/* Reporting: inside the player, so nothing opens behind it. */}
      {reporting && (
        <Pressable style={[StyleSheet.absoluteFill, styles.panelBackdrop]} onPress={() => setReporting(null)} />
      )}
      <Animated.View
        pointerEvents={reporting ? 'auto' : 'none'}
        style={[
          styles.panel,
          { paddingBottom: insets.bottom + 18, width: Math.min(W, 460) },
          {
            opacity: panel,
            transform: [{ translateY: panel.interpolate({ inputRange: [0, 1], outputRange: [380, 0] }) }],
          },
        ]}
      >
        {reporting === 'sent' ? (
          <View style={styles.panelBody}>
            <View style={[styles.panelIcon, styles.panelIconOk]}>
              <Icon name="checkmark" size={24} color={theme.ok} />
            </View>
            <Text style={styles.panelTitle}><Trans>Thank you for telling us</Trans></Text>
            <Text style={styles.panelText}>
              <Trans>
                We will look at it, and take it down if it breaks the rules. The shop is not told who reported it.
              </Trans>
            </Text>
            <PressableScale onPress={() => setReporting(null)} style={styles.panelPrimary} accessibilityRole="button">
              <Text style={styles.panelPrimaryText}><Trans>Keep watching</Trans></Text>
            </PressableScale>
          </View>
        ) : !signedIn ? (
          <View style={styles.panelBody}>
            <View style={styles.panelIcon}>
              <Icon name="flag" size={22} color={theme.accentDeep} />
            </View>
            <Text style={styles.panelTitle}><Trans>Sign in to report a story</Trans></Text>
            <Text style={styles.panelText}><Trans>So we know a real person is asking.</Trans></Text>
            <PressableScale
              onPress={() => close(() => router.push('/sign-in'))}
              style={styles.panelPrimary}
              accessibilityRole="button"
            >
              <Text style={styles.panelPrimaryText}><Trans>Sign in</Trans></Text>
            </PressableScale>
            <PressableScale onPress={() => setReporting(null)} style={styles.panelQuiet} accessibilityRole="button">
              <Text style={styles.panelQuietText}><Trans>Not now</Trans></Text>
            </PressableScale>
          </View>
        ) : (
          <View style={styles.panelBody}>
            <Text style={styles.panelTitle}><Trans>What is wrong with this story?</Trans></Text>
            <Text style={styles.panelText}><Trans>The shop is not told who reported it.</Trans></Text>
            <View style={styles.reasons}>
              {reasons().map((reason) => (
                <PressableScale
                  key={reason}
                  disabled={report.isPending || !story}
                  onPress={() => story && report.mutate({ id: story.id, reason })}
                  style={styles.reason}
                  accessibilityRole="button"
                >
                  <Text style={styles.reasonText}>{reason}</Text>
                  {report.isPending && report.variables?.reason === reason ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                  ) : (
                    <Icon name="chevron-forward" size={16} color={theme.muted} />
                  )}
                </PressableScale>
              ))}
            </View>
            {report.error && (
              <Text style={styles.panelError}>
                {report.error instanceof ApiError ? report.error.message : t`That did not send. Check your connection.`}
              </Text>
            )}
            <PressableScale onPress={() => setReporting(null)} style={styles.panelQuiet} accessibilityRole="button">
              <Text style={styles.panelQuietText}><Trans>Cancel</Trans></Text>
            </PressableScale>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

/** On a wide screen: to the shop before or after, beside the frame. */
function Arrow({
  icon,
  label,
  onPress,
  hidden,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  onPress: () => void;
  hidden: boolean;
}) {
  return (
    <View style={styles.arrowSlot}>
      {!hidden && (
        <PressableScale onPress={onPress} style={styles.arrow} accessibilityRole="button" accessibilityLabel={label}>
          <Icon name={icon} size={22} color={theme.ink} />
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#0B0F0B' },
  center: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  stage: { backgroundColor: '#000000', overflow: 'hidden' },
  stageWide: { borderRadius: 22 },
  blur: { opacity: 0.85 },
  shade: { backgroundColor: 'rgba(0,0,0,0.28)' },
  spinner: { position: 'absolute', top: '50%', alignSelf: 'center', marginTop: -18 },
  brokenBox: { position: 'absolute', top: '45%', left: 0, right: 0, alignItems: 'center', gap: 8 },
  brokenText: { fontFamily: font.semibold, fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  fadeTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  head: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 10 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 2 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 },
  logo: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  whoText: { flex: 1 },
  shopName: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 4,
  },
  when: { fontFamily: font.medium, fontSize: 12, color: 'rgba(255,255,255,0.82)' },
  headButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  foot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 14 },
  caption: {
    fontFamily: font.bold,
    fontSize: 17,
    lineHeight: 24,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 6,
  },
  book: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
  },
  bookText: { flexShrink: 1, fontFamily: font.extrabold, fontSize: 15.5, color: theme.ink },

  arrowSlot: { width: 80, alignItems: 'center' },
  arrow: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },

  panelBackdrop: { backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: theme.panel,
  },
  panelBody: { padding: 22, gap: 10, alignItems: 'stretch' },
  panelIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accentSoft,
    marginBottom: 4,
  },
  panelIconOk: { backgroundColor: theme.okSoft },
  panelTitle: { fontFamily: font.extrabold, fontSize: 18, color: theme.ink, textAlign: 'center' },
  panelText: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: theme.ink2, textAlign: 'center' },
  reasons: { marginTop: 6, borderRadius: radius.md, backgroundColor: theme.sunken, overflow: 'hidden' },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  reasonText: { fontFamily: font.semibold, fontSize: 14.5, color: theme.ink },
  panelError: { fontFamily: font.semibold, fontSize: 13, color: theme.danger, textAlign: 'center' },
  panelPrimary: {
    height: 50,
    marginTop: 8,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
  },
  panelPrimaryText: { fontFamily: font.extrabold, fontSize: 15, color: '#FFFFFF' },
  panelQuiet: { height: 44, alignItems: 'center', justifyContent: 'center' },
  panelQuietText: { fontFamily: font.bold, fontSize: 14.5, color: theme.ink2 },
});
