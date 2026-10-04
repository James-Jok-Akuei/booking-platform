import { useWindowDimensions } from 'react-native';

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
  /** The widest a column of content should get before it is centred. */
  const contentWidth = Math.min(width, wide ? 920 : 560);
  const gutter = width < 360 ? 14 : 20;
  const columns = wide ? 2 : 1;
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
