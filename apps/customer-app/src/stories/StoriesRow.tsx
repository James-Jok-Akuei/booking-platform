import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { StoryShop } from '../api/stories';
import { font, theme } from '../theme';
import { Avatar } from '../ui/Avatar';
import { FadeIn } from '../ui/FadeIn';
import { PressableScale } from '../ui/PressableScale';
import { StoryRing } from './StoryRing';
import { allSeen, useSeenStories } from './seen';

const LOGO = 60;

/**
 * Today's stories, along the top of Home (§285): a round logo per shop, ringed
 * in coral while it has something new, with its name underneath. A tap plays
 * that shop's stories and then the next shop's. Not there at all when no shop
 * has posted one.
 */
export function StoriesRow({
  shops,
  onOpen,
  style,
  contentStyle,
}: {
  shops: StoryShop[];
  onOpen: (index: number) => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const seen = useSeenStories();
  if (shops.length === 0) return null;

  return (
    <FadeIn delay={90}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={[styles.row, contentStyle]}
      >
        {shops.map((shop, i) => {
          const done = allSeen(seen, shop);
          const count = shop.stories.length;
          return (
            <FadeIn key={shop.business.id} index={i}>
              <PressableScale
                onPress={() => onOpen(i)}
                haptic
                scaleTo={0.92}
                style={styles.bubble}
                accessibilityRole="button"
                accessibilityLabel={`${shop.business.name}: ${count} ${count === 1 ? 'story' : 'stories'}${done ? ', seen' : ', new'}`}
              >
                <StoryRing size={LOGO} seen={done}>
                  <View style={styles.logo}>
                    <Avatar uri={shop.business.logoUrl} name={shop.business.name} size={LOGO} />
                  </View>
                </StoryRing>
                <Text numberOfLines={1} style={[styles.name, done && styles.nameSeen]}>
                  {shop.business.name}
                </Text>
              </PressableScale>
            </FadeIn>
          );
        })}
      </ScrollView>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  row: { gap: 12, paddingVertical: 2 },
  bubble: { width: 76, alignItems: 'center', gap: 6 },
  logo: { borderRadius: LOGO / 2, backgroundColor: theme.panel, overflow: 'hidden' },
  name: {
    maxWidth: 76,
    fontFamily: font.semibold,
    fontSize: 11.5,
    lineHeight: 15,
    color: theme.ink,
    textAlign: 'center',
  },
  nameSeen: { color: theme.muted },
});
