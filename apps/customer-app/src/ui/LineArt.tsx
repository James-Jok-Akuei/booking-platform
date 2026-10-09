import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { theme } from '../theme';
import { useReducedMotion } from './Motion';
import { SWASH, drawingFor } from './lineArtData';

const AnimatedPath = Animated.createAnimatedComponent(Path);
/**
 * In a browser an animated SVG path hands React Native's internal props to
 * the page and warns; there the drawing is simply shown (the phone draws it in).
 */
const STILL = Platform.OS === 'web';

/** Longer than any one stroke, so each draws from nothing. */
const DASH = 600;

/**
 * A kind of shop as a fine-line drawing (§264): the same drawings the
 * business app and the console use (`lineArtData.ts`), one thin ink line
 * over a soft brush mark in the category's colour. The line draws itself in
 * the first time it appears; with "reduce motion" it is simply there.
 *
 * Sized by its width; the sheet is always twice as wide as it is tall.
 */
export function LineArt({
  icon,
  width,
  delay = 0,
  ink = theme.ink,
  swash = true,
  style,
}: {
  icon: string | null | undefined;
  width: number;
  delay?: number;
  ink?: string;
  /** The brush mark behind; off where the drawing sits on its own colour. */
  swash?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const art = drawingFor(icon);
  const reduced = useReducedMotion();
  const drawn = useRef(new Animated.Value(reduced || STILL ? 1 : 0)).current;

  useEffect(() => {
    if (reduced || STILL) {
      drawn.setValue(1);
      return;
    }
    const run = Animated.timing(drawn, {
      toValue: 1,
      duration: 1500,
      delay: delay + 120,
      easing: Easing.bezier(0.45, 0.05, 0.3, 1),
      // Stroke offsets are drawn on the JS side.
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [drawn, delay, reduced]);

  const offset = drawn.interpolate({ inputRange: [0, 1], outputRange: [DASH, 0] });

  return (
    <Svg width={width} height={width / 2} viewBox="0 0 200 100" style={style} pointerEvents="none">
      {swash && <Path d={SWASH} fill={art.swash} opacity={0.9} />}
      <G stroke={ink} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {art.strokes.map((s, i) => {
          const turn = s.transform ? { transform: s.transform } : {};
          return STILL ? (
            <Path key={i} d={s.d} {...turn} />
          ) : (
            <AnimatedPath key={i} d={s.d} {...turn} strokeDasharray={[DASH, DASH]} strokeDashoffset={offset} />
          );
        })}
      </G>
    </Svg>
  );
}
