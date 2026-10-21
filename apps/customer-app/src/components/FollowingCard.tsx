import { StyleSheet, Text, View } from 'react-native';
import type { Follow, FollowNews } from '../api/notifications';
import { StoryRing } from '../stories/StoryRing';
import { font, radius, shadow, theme, type } from '../theme';
import { Avatar } from '../ui/Avatar';
import { Cover } from '../ui/Cover';
import { Icon, type IconName } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { RatingBadge } from '../ui/Stars';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

const NEWS_LOOK: Record<FollowNews['kind'], { icon: IconName; fg: string; bg: string }> = {
  DISCOUNT: { icon: 'pricetag', fg: theme.accentDeep, bg: theme.accentSoft },
  NEW_SERVICE: { icon: 'sparkles', fg: theme.ok, bg: theme.okSoft },
  MESSAGE: { icon: 'megaphone', fg: theme.ask, bg: theme.askSoft },
};

/**
 * A shop you follow (§288): its picture, and under it what is new there — a
 * discount on now, a service added in the last two weeks, this week's
 * message. The news is the point of the card; a shop with none still shows,
 * so the list is also simply "the places I like".
 *
 * Two small controls of its own, apart from the card's tap: a bell for its
 * offers as notifications (a separate yes), and Following, to stop.
 */
export function FollowingCard({
  follow,
  width,
  onOpen,
  onNews,
  onOffers,
  onUnfollow,
}: {
  follow: Follow;
  width?: number;
  onOpen: () => void;
  onNews: (news: FollowNews) => void;
  onOffers: () => void;
  onUnfollow: () => void;
}) {
  const shop = follow.business;
  const name = shop.name;
  const closed = !follow.bookAt;

  return (
    // The card opens the shop but is not itself a button: it holds the news
    // rows, the bell and Following, which must be reached one by one.
    <PressableScale onPress={onOpen} scaleTo={0.985} accessible={false} style={[styles.card, width ? { width } : null]}>
      <View>
        <Cover uri={shop.coverImageUrl} categoryIcon={shop.categoryIcon} style={styles.cover} iconSize={34} />
        <View style={styles.rating}>
          <RatingBadge average={follow.ratingAvg} count={follow.ratingCount} onPhoto />
        </View>
        <View style={styles.logo}>
          {follow.hasStory ? (
            <StoryRing size={46} seen={false} gap={theme.panel}>
              <Avatar uri={shop.logoUrl} name={shop.name} size={46} />
            </StoryRing>
          ) : (
            <View style={styles.logoPlain}>
              <Avatar uri={shop.logoUrl} name={shop.name} size={46} />
            </View>
          )}
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {shop.name}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {[follow.hasStory ? t`Story up now` : null, follow.district].filter(Boolean).join(' · ') || ' '}
        </Text>

        {follow.news.length > 0 && (
          <View style={styles.news}>
            {follow.news.slice(0, 3).map((item, i) => {
              const look = NEWS_LOOK[item.kind];
              return (
                <PressableScale
                  key={`${item.kind}-${item.serviceId ?? i}`}
                  onPress={() => onNews(item)}
                  scaleTo={0.98}
                  accessibilityRole="button"
                  accessibilityLabel={[item.title, item.detail].filter(Boolean).join('. ')}
                  style={styles.newsRow}
                >
                  <View style={[styles.newsIcon, { backgroundColor: look.bg }]}>
                    <Icon name={look.icon} size={15} color={look.fg} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.newsTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.detail && (
                      <Text style={styles.newsDetail} numberOfLines={2}>
                        {item.detail}
                      </Text>
                    )}
                  </View>
                  <Icon name="chevron-forward" size={16} color={theme.muted} />
                </PressableScale>
              );
            })}
          </View>
        )}

        {closed && <Text style={styles.note}><Trans>Not taking bookings right now. It stays here until it does.</Trans></Text>}

        <View style={styles.foot}>
          <PressableScale
            onPress={onOffers}
            scaleTo={0.95}
            accessibilityRole="switch"
            accessibilityState={{ checked: follow.offers }}
            accessibilityLabel={t`Offers from ${name} as notifications`}
            style={[styles.chip, follow.offers && styles.chipOn]}
          >
            <Icon
              name={follow.offers ? 'notifications' : 'notifications-off-outline'}
              size={15}
              color={follow.offers ? theme.accentDeep : theme.muted}
            />
            <Text style={[styles.chipText, follow.offers && styles.chipTextOn]}>
              {follow.offers ? t`Offers: on` : t`Offers: off`}
            </Text>
          </PressableScale>
          <PressableScale
            onPress={onUnfollow}
            scaleTo={0.95}
            accessibilityRole="button"
            accessibilityLabel={t`Following ${name}. Tap to unfollow`}
            style={styles.following}
          >
            <Icon name="heart" size={15} color={theme.accentDeep} />
            <Text style={styles.followingText}><Trans>Following</Trans></Text>
          </PressableScale>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.panel, borderRadius: radius.xl, padding: 10, ...shadow.card },
  cover: { height: 120, borderRadius: radius.lg },
  rating: { position: 'absolute', left: 10, top: 10 },
  logo: { position: 'absolute', left: 12, bottom: -26 },
  logoPlain: { borderRadius: 28, borderWidth: 3, borderColor: theme.panel },
  body: { paddingHorizontal: 8, paddingTop: 34, paddingBottom: 6, gap: 3 },
  name: { fontFamily: font.bold, fontSize: 17, color: theme.ink, letterSpacing: -0.2 },
  flex: { flex: 1, minWidth: 0 },
  news: { gap: 8, marginTop: 10 },
  newsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  newsIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  newsTitle: { fontFamily: font.bold, fontSize: 13.5, color: theme.ink },
  newsDetail: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 17, color: theme.ink2, marginTop: 1 },
  note: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 18, color: theme.warn, marginTop: 8 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.sunken,
  },
  chipOn: { backgroundColor: theme.accentSoft },
  chipText: { fontFamily: font.bold, fontSize: 12.5, color: theme.muted },
  chipTextOn: { color: theme.accentDeep },
  following: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.accentSoft,
  },
  followingText: { fontFamily: font.bold, fontSize: 12.5, color: theme.accentDeep },
});
