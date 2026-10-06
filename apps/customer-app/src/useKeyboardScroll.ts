import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

/** Room left between the field and the top of the keyboard. */
const MARGIN = 28;

/**
 * Keeps whatever is being typed into above the keyboard (§168).
 *
 * Android apps now draw edge-to-edge, and under that the system no longer
 * shrinks the window when the keyboard opens — so a field in the middle of a
 * scrolling page simply ended up behind it, with nothing on screen moving.
 * This does by hand what the system used to: when the keyboard appears (or a
 * field is focused while it is up), it measures the focused field, and if the
 * keyboard covers it, scrolls the page by exactly the overlap.
 *
 * `pad` adds the keyboard's height to the bottom of the scroll content, so the
 * page CAN scroll that far. Leave it off on a screen already inside a
 * `KeyboardAvoidingView`, which shrinks the page itself; padding there too
 * would leave a gap the size of a keyboard.
 */
export function useKeyboardScroll({ pad = false }: { pad?: boolean } = {}) {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const [height, setHeight] = useState(0);

  const reveal = useCallback(() => {
    const top = keyboardTop.current;
    if (top === null) return;
    // Measured after a beat, so a screen that pads or shrinks for the keyboard
    // has done so and the page can actually scroll as far as asked.
    setTimeout(() => {
      const input = TextInput.State.currentlyFocusedInput() as unknown as {
        measureInWindow?: (done: (x: number, y: number, w: number, h: number) => void) => void;
      } | null;
      input?.measureInWindow?.((_x, y, _w, h) => {
        const overlap = y + h + MARGIN - top;
        if (overlap > 0) {
          ref.current?.scrollTo({ y: offset.current + overlap, animated: true });
        }
      });
    }, 120);
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setHeight(e.endCoordinates.height);
      reveal();
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = null;
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reveal]);

  return {
    /** Give this to the ScrollView. */
    ref,
    /** Keeps track of how far the page is scrolled; call from `onScroll`. */
    track: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    /** Extra bottom padding for the scroll content while the keyboard is up. */
    padding: pad ? height : 0,
    /** Call from a field's `onFocus`: moving between fields with the keyboard already up. */
    reveal,
  };
}
