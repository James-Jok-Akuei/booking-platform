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
import { useSignedIn } from '../api/client';
import { useUnread } from '../useUnread';
import { CountBadge } from './CountBadge';
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
 * Tabs that are only somebody's (§170): a visitor has no bookings, nothing
 * saved and nobody to message. Signed out they are not shown at all — an icon
 * that only ever leads to "sign in first" is clutter — and they appear the
 * moment the person signs in.
 */
const PRIVATE_TABS = new Set(['bookings', 'saved', 'messages']);
const SIGN_IN_ICON = { idle: 'log-in-outline' as IconName, on: 'log-in' as IconName };

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

  // Unread MESSAGES only (§134): the bell on the home screen carries the
  // notifications, so each number points at the screen that clears it.
  const unread = useUnread().messages;
  const signedIn = useSignedIn();

  // Signed out while on a private tab — the session ended, or they signed out
  // from elsewhere — goes home rather than sitting on a screen they cannot use.
  const current = state.routes[state.index]?.name;
  useEffect(() => {
    if (!signedIn && current && PRIVATE_TABS.has(current)) navigation.navigate('index');
  }, [signedIn, current, navigation]);

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
          if (!signedIn && PRIVATE_TABS.has(route.name)) return null;
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          // Signed out, the account tab is the way in, and says so.
          const signIn = !signedIn && route.name === 'account';
          const label = signIn
            ? 'Sign in'
            : typeof options.title === 'string'
              ? options.title
              : route.name;

          return (
            <Tab
              key={route.key}
              label={label}
              icon={signIn ? SIGN_IN_ICON : (ICONS[route.name] ?? ICONS.index)}
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
          {/* The NUMBER, not a dot (§134): "3" says how much is waiting, and
              it stays while the tab is open, until the messages are read. */}
          <CountBadge
            count={badge}
            ring={focused ? theme.accent : theme.night}
            inverse={focused}
            style={styles.badge}
          />
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
  badge: { position: 'absolute', top: -8, right: -11 },
});
