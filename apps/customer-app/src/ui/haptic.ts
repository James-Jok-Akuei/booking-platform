import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * The small tick under a finger (§133).
 *
 * Fire-and-forget, and silent where there is nothing to tick: the web has no
 * haptics, and an old handset may refuse. A feedback effect must never be the
 * reason a tap fails.
 */
export const tick = () => {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => undefined);
};

/** A firmer one, for something that committed: booked, saved, sent. */
export const thump = () => {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
};

/** Success, for the one or two moments that deserve it. */
export const cheer = () => {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
};

/** A warning, for a question about something that cannot be undone, or a thing that failed. */
export const caution = () => {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
};
