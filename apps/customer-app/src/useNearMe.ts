import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type NearMeState =
  | { status: 'off' }
  | { status: 'asking' }
  | { status: 'on'; lat: number; lng: number }
  | { status: 'denied' }
  | { status: 'failed' };

/**
 * Where the customer is, if they choose to say (§107).
 *
 * Three rules, all of them consequences of the same instruction — place is a
 * filter a customer applies, never one applied to them (§106.2):
 *
 * 1. **Never asked on open.** The permission prompt fires only when someone
 *    taps "Nearest", which is the moment it makes sense of itself. An app that
 *    asks before showing anything gets declined, and deservedly.
 * 2. **Declining costs nothing.** Every listing is still there, in whatever
 *    order was chosen before. There is no degraded mode.
 * 3. **It orders, it does not exclude.** The position is sent without a
 *    radius, so the nearest shop comes first and the one across town is still
 *    on the list.
 */
export function useNearMe() {
  const [state, setState] = useState<NearMeState>({ status: 'off' });

  const enable = useCallback(async () => {
    setState({ status: 'asking' });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState({ status: 'denied' });
        return;
      }
      // Balanced, not High: this sorts a list of shops. Street-level accuracy
      // would cost battery and a visible delay to change nothing a customer
      // would notice.
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setState({
        status: 'on',
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
    } catch {
      // A phone indoors with no fix is not an error worth a dialog. The list
      // goes back to how it was.
      setState({ status: 'failed' });
    }
  }, []);

  /**
   * Someone who ALREADY said yes is not asked again and should not have to tap
   * anything to get their distances back (§139). This only reads a permission
   * that exists — it never raises the prompt, so rule 1 above still holds for
   * everybody who has not been asked.
   *
   * The last known fix is used first because it is instant; the fresh one
   * replaces it when it arrives.
   */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || !live) return;
        const known = await Location.getLastKnownPositionAsync();
        if (known && live) {
          setState((was) =>
            was.status === 'off'
              ? { status: 'on', lat: known.coords.latitude, lng: known.coords.longitude }
              : was,
          );
        }
        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (live) {
          setState({ status: 'on', lat: fresh.coords.latitude, lng: fresh.coords.longitude });
        }
      } catch {
        // Quietly nothing: this was a convenience nobody asked for.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const disable = useCallback(() => setState({ status: 'off' }), []);

  return { state, enable, disable };
}
