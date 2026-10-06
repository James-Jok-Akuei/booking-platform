import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { font, radius, shadow, theme } from '../theme';
import { tick } from './haptic';

/**
 * Two or three choices where exactly one is on (§133) — Upcoming and Past.
 *
 * The white thumb SLIDES between them rather than jumping, which is what tells
 * the eye that these are two views of one list and not two different screens.
 * Its width comes from measuring the track, so it is right on any phone.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Shorter, for a choice that sits among other controls rather than heading a screen. */
  compact?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const slide = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: index,
      useNativeDriver: true,
      speed: 18,
      bounciness: 5,
    }).start();
  }, [index, slide]);

  const pad = compact ? 3 : 4;
  const segment = width > 0 ? (width - pad * 2) / options.length : 0;

  return (
    <View
      style={[styles.track, { padding: pad }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {segment > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            {
              top: pad,
              left: pad,
              bottom: pad,
              width: segment,
              transform: [{ translateX: Animated.multiply(slide, segment) }],
            },
          ]}
        />
      )}
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={[styles.option, compact && styles.optionCompact]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (!on) tick();
              onChange(option.value);
            }}
          >
            <Text style={[styles.label, compact && styles.labelCompact, on && styles.labelOn]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: '#EBE8E1',
    borderRadius: radius.pill,
  },
  thumb: {
    position: 'absolute',
    borderRadius: radius.pill,
    backgroundColor: theme.panel,
    ...shadow.card,
  },
  option: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' },
  optionCompact: { height: 32 },
  label: { fontFamily: font.semibold, fontSize: 14, color: theme.muted },
  labelCompact: { fontSize: 13 },
  labelOn: { color: theme.ink, fontFamily: font.bold },
});
