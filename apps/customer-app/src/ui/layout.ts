import { Platform, useWindowDimensions } from 'react-native';

/** The reading width a tablet's column stops at. */
const READING_WIDTH = 920;

/**
 * How much room there is, and what to do with it (§133).
 *
 * A phone gets one column edge to edge. Anything wider — a tablet, a foldable
 * opened out, a phone on its side — gets two columns and a reading width, so a
 * card is never stretched into a banner and a line of text never runs the full
 * width of a tablet.
 *
 * Read from the window on every render rather than once, so rotating the
 * device or unfolding it re-flows the screen instead of leaving it wrong.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const wide = width >= 700;
  /**
   * The widest a column of content should get before it is centred. On the
   * web, a desktop window keeps only HALF the empty space a tablet's reading
   * width would leave at each side (the user, 2026-10-20): a laptop has the
   * room, and two wide bands of nothing made the app look like a phone page.
   */
  const contentWidth = !wide
    ? Math.min(width, 560)
    : width <= READING_WIDTH
      ? width
      : Platform.OS === 'web'
        ? Math.round((width + READING_WIDTH) / 2)
        : READING_WIDTH;
  const gutter = width < 360 ? 14 : 20;
  // A third column once there is room for three cards of a tablet's size.
  const columns = !wide ? 1 : contentWidth >= 1100 ? 3 : 2;
  return {
    width,
    height,
    wide,
    /** A small phone, where type and padding step down a notch. */
    compact: width < 360,
    contentWidth,
    gutter,
    columns,
    /** Width of one card in a `columns`-wide grid with a 14pt gap. */
    cardWidth: (contentWidth - gutter * 2 - 14 * (columns - 1)) / columns,
  };
}
