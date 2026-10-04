import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useQuery } from '@tanstack/react-query';
import { listThreads } from '../api/chat';
import { useSignedIn } from '../api/client';
import { font, radius, shadow, theme } from '../theme';
import { tick } from './haptic';
import { Icon, type IconName } from './Icon';

/** The icon for each tab, outlined when idle and filled when it is the one you are on. */
const ICONS: Record<string, { idle: IconName; on: IconName }> = {
  index: { idle: 'home-outline', on: 'home' },
  bookings: { idle: 'calendar-outline', on: 'calendar' },
  saved: { idle: 'heart-outline', on: 'heart' },
  messages: { idle: 'chatbubble-ellipses-outline', on: 'chatbubble-ellipses' },
  account: { idle: 'person-outline', on: 'person' },
};

/**
 * The floating tab bar (§133).
 *
 * The five places a customer goes — which until now were four text links
 * crammed into the header of one screen, and reachable from nowhere else. A
 * booking could only be found again by going home first.
 *
 * It FLOATS: a dark capsule clear of the bottom edge with content passing
 * behind it, so the screen reads as one surface with a control resting on it.
 * The tab you are on opens into a coral pill carrying its name; the others are
 * icons. One label at a time is enough to be sure where you are, and five
 * labels would not fit a small phone without shrinking all of them.
 *
 * It steps out of the way when the keyboard is up. On Android the window
 * resizes around the keyboard, so a floating bar would otherwise ride up and
 * sit on top of the field being typed into.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const [keyboardUp, setKeyboardUp] = useState(false);
  const signedIn = useSignedIn();
  // On the narrowest phones the bar sits closer to the edges, or the fifth tab
  // would be pushed off the end of it.
  const narrow = useWindowDimensions().width < 360;

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The same query the Messages screen reads, so the two can never disagree and
  // opening that screen costs no second request. Only asked for when signed in.
  const threads = useQuery({
    queryKey: ['threads'],
    queryFn: () => listThreads({ limit: 50 }),
    enabled: signedIn,
    staleTime: 60_000,
  });
  const unread =
    !signedIn ? 0 : threads.data?.threads.reduce((sum, thread) => sum + thread.unreadCount, 0) ?? 0;

  if (keyboardUp) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, 10) + 6 },
        narrow && styles.wrapNarrow,
      ]}
    >
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;

          return (
            <Tab
              key={route.key}
              label={label}
              icon={ICONS[route.name] ?? ICONS.index}
              focused={focused}
              badge={route.name === 'messages' ? unread : 0}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  tick();
                  navigation.navigate(route.name, route.params);
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function Tab({
  label,
  icon,
  focused,
  badge,
  onPress,
}: {
  label: string;
  icon: { idle: IconName; on: IconName };
  focused: boolean;
  badge: number;
  onPress: () => void;
}) {
  // One value drives the pill, the label and the icon's lift. Not on the native
  // driver, because it animates a width — and five small views is nothing.
  const open = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(open, {
      toValue: focused ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [focused, open]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
      hitSlop={6}
      style={styles.tab}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: open.interpolate({
              inputRange: [0, 1],
              outputRange: ['rgba(240,83,45,0)', theme.accent],
            }),
            // An idle tab is only an icon and needs little room around it; the
            // open one needs the padding to be a pill. Animating it is what
            // lets five tabs fit a 320-point screen.
            paddingHorizontal: open.interpolate({ inputRange: [0, 1], outputRange: [8, 14] }),
          },
        ]}
      >
        <View>
          <Icon
            name={focused ? icon.on : icon.idle}
            size={21}
            color={focused ? '#FFFFFF' : 'rgba(255,255,255,0.62)'}
          />
          {badge > 0 && !focused && <View style={styles.badge} />}
        </View>
        <Animated.View
          style={{
            maxWidth: open.interpolate({ inputRange: [0, 1], outputRange: [0, 96] }),
            opacity: open,
            overflow: 'hidden',
          }}
        >
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  wrapNarrow: { paddingHorizontal: 10 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 440,
    height: 68,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.night,
    ...shadow.float,
  },
  tab: { height: 68, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    borderRadius: radius.pill,
  },
  label: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: '#FFFFFF',
    paddingLeft: 7,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: theme.accent,
    borderWidth: 1.5,
    borderColor: theme.night,
  },
});
