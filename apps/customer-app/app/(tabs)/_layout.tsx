import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '../../src/ui/TabBar';
import { theme } from '../../src/theme';
import { t } from '@lingui/core/macro';

/**
 * The five places a customer lives in (§133).
 *
 * A group, so the addresses do not change: `/bookings` is still `/bookings`,
 * and every link, redirect and `next=` in the app keeps working. What changes
 * is that all five are one tap from anywhere, instead of four of them being
 * text links in the header of the fifth.
 *
 * No native header on any of them — each screen draws its own large title, in
 * the app's own type.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t`Home` }} />
      <Tabs.Screen name="bookings" options={{ title: t`Bookings` }} />
      <Tabs.Screen name="saved" options={{ title: t`Saved` }} />
      <Tabs.Screen name="messages" options={{ title: t`Messages` }} />
      <Tabs.Screen name="account" options={{ title: t`Account` }} />
    </Tabs>
  );
}
