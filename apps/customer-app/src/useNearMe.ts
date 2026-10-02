import { useCallback, useState } from 'react';
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

  const disable = useCallback(() => setState({ status: 'off' }), []);

  return { state, enable, disable };
}
