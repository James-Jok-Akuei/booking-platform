import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  getNotificationSettings,
  listFollows,
  unfollowShop,
  updateNotificationSettings,
  type NotificationCategorySetting,
  type NotificationSettings,
  type NotificationSettingsChange,
} from '../src/api/notifications';
import { ApiError, useSignedIn } from '../src/api/client';
import { askForPush, pushState, type PushState } from '../src/push';
import { font, radius, shadow, theme, type } from '../src/theme';
import { AppSwitch } from '../src/ui/AppSwitch';
import { Avatar } from '../src/ui/Avatar';
import { EmptyState } from '../src/ui/EmptyState';
import { FadeIn } from '../src/ui/FadeIn';
import { Icon, type IconName } from '../src/ui/Icon';
import { useLayout } from '../src/ui/layout';
import { PressableScale } from '../src/ui/PressableScale';
import { Sheet } from '../src/ui/Sheet';
import { RowSkeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';

const MARK: Record<string, { icon: IconName; bg: string; fg: string }> = {
  BOOKINGS: { icon: 'calendar', bg: theme.askSoft, fg: theme.ask },
  REMINDERS: { icon: 'alarm-outline', bg: theme.warnSoft, fg: theme.warn },
  MESSAGES: { icon: 'chatbubble-ellipses', bg: theme.accentSoft, fg: theme.accentDeep },
  REVIEWS: { icon: 'star', bg: '#FFF4D9', fg: '#C98A00' },
  SHOP_OFFERS: { icon: 'storefront', bg: theme.okSoft, fg: theme.ok },
  NEWS: { icon: 'sparkles', bg: theme.accentSoft, fg: theme.accent },
  ACCOUNT: { icon: 'person-circle', bg: theme.sunken, fg: theme.ink2 },
};

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const TIMES = Array.from({ length: 48 }, (_, i) => i * 30);

/**
 * What we send you, and how (§287). Your notifications in the app always have
 * everything; here you choose what also comes as an alert on this phone or an
 * email. News and offers are off until you say yes, and each shop's offers
 * come only if you follow it.
 */
export default function NotificationSettingsScreen() {
  const signedIn = useSignedIn();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['notification-settings'],
    queryFn: getNotificationSettings,
    enabled: signedIn,
  });
  const follows = useQuery({ queryKey: ['follows'], queryFn: listFollows, enabled: signedIn });
  const [push, setPush] = useState<PushState | null>(null);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  // Asked again when coming back from the phone's settings.
  useEffect(() => {
    const check = () => void pushState().then(setPush);
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  const save = useMutation({
    mutationFn: (change: NotificationSettingsChange) => updateNotificationSettings(change),
    onMutate: (change) => {
      const before = queryClient.getQueryData<NotificationSettings>(['notification-settings']);
      if (before) queryClient.setQueryData(['notification-settings'], apply(before, change));
      return { before };
    },
    onError: (_e, _c, context) => {
      if (context?.before) queryClient.setQueryData(['notification-settings'], context.before);
    },
    onSuccess: (next) => queryClient.setQueryData(['notification-settings'], next),
  });
  const unfollow = useMutation({
    mutationFn: unfollowShop,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['follows'] }),
  });

  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <TopBar title="Notifications" />
        <EmptyState
          icon="notifications-outline"
          title="Sign in to choose"
          text="What we send you is set on your account."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/notification-settings')}
        />
      </View>
    );
  }

  const s = settings.data;
  const choose = (category: string, channel: 'EMAIL' | 'PUSH', on: boolean) =>
    save.mutate({ choices: [{ category: category as never, channel, on }] });

  return (
    <View style={styles.screen}>
      <TopBar title="Notifications" />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + 32, width: layout.contentWidth, paddingHorizontal: layout.gutter },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>
          <PhoneAlerts
            state={push}
            onTurnOn={async () => {
              setPush(await askForPush());
              void settings.refetch();
            }}
          />
        </FadeIn>

        {save.error && (
          <Text style={styles.problem}>
            {save.error instanceof ApiError ? save.error.message : 'That did not save. Check your connection.'}
          </Text>
        )}

        <FadeIn delay={60}>
          <Text style={styles.group}>What we send you</Text>
          <View style={styles.card}>
            {settings.isLoading && <RowSkeleton />}
            {s?.categories.map((row, i) => (
              <View key={row.category}>
                {i > 0 && <View style={styles.divider} />}
                <KindRow row={row} wording={s.newsWording} pushOn={push === 'on'} onChoose={choose} />
                {row.category === 'SHOP_OFFERS' && (follows.data?.follows.length ?? 0) > 0 && (
                  <View style={styles.follows}>
                    {follows.data!.follows.map((f) => (
                      <View key={f.business.id} style={styles.follow}>
                        <Avatar uri={f.business.logoUrl} name={f.business.name} size={30} />
                        <Text style={styles.followName} numberOfLines={1}>
                          {f.business.name}
                        </Text>
                        <PressableScale
                          onPress={() => unfollow.mutate(f.business.id)}
                          disabled={unfollow.isPending}
                          style={styles.unfollow}
                          accessibilityRole="button"
                          accessibilityLabel={`Stop following ${f.business.name}`}
                        >
                          <Text style={styles.unfollowText}>Unfollow</Text>
                        </PressableScale>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        </FadeIn>

        {s && (
          <FadeIn delay={120}>
            <Text style={styles.group}>Quiet hours</Text>
            <View style={[styles.card, styles.quiet]}>
              <View style={styles.quietHead}>
                <View style={styles.moon}>
                  <Icon name="moon" size={18} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>Hold alerts that can wait</Text>
                  <Text style={type.small}>
                    Reviews, offers and news arrive after. Bookings, reminders and messages still come straight away.
                  </Text>
                </View>
                <AppSwitch
                  value={s.quietHours.on}
                  accessibilityLabel="Quiet hours"
                  onValueChange={(on) => save.mutate({ quietHours: { ...s.quietHours, on } })}
                />
              </View>
              <View style={[styles.times, !s.quietHours.on && styles.timesOff]}>
                {(['from', 'to'] as const).map((which) => (
                  <View key={which} style={styles.flex}>
                    <PressableScale
                      disabled={!s.quietHours.on}
                      onPress={() => setPicking(which)}
                      style={styles.time}
                      accessibilityRole="button"
                      accessibilityLabel={`${which === 'from' ? 'From' : 'Until'} ${clock(s.quietHours[which])}`}
                    >
                      <Text style={styles.timeLabel}>{which === 'from' ? 'From' : 'Until'}</Text>
                      <Text style={styles.timeValue}>{clock(s.quietHours[which])}</Text>
                    </PressableScale>
                  </View>
                ))}
              </View>
            </View>
          </FadeIn>
        )}

        <Text style={styles.foot}>
          Weekly offers near you by email are under Account → Offers. Every email we send also has a link to stop emails
          like it.
        </Text>
      </ScrollView>

      <Sheet
        open={picking !== null}
        title={picking === 'from' ? 'Quiet from' : 'Quiet until'}
        onClose={() => setPicking(null)}
      >
        <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetBody}>
          {s &&
            TIMES.map((m) => {
              const on = picking ? s.quietHours[picking] === m : false;
              return (
                <PressableScale
                  key={m}
                  onPress={() => {
                    if (picking) save.mutate({ quietHours: { ...s.quietHours, [picking]: m } });
                    setPicking(null);
                  }}
                  style={[styles.sheetTime, on && styles.sheetTimeOn]}
                >
                  <Text style={[styles.sheetTimeText, on && styles.sheetTimeTextOn]}>{clock(m)}</Text>
                </PressableScale>
              );
            })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/** A change, shown before the server answers. */
function apply(s: NotificationSettings, change: NotificationSettingsChange): NotificationSettings {
  return {
    ...s,
    categories: s.categories.map((c) =>
      (change.choices ?? [])
        .filter((x) => x.category === c.category)
        .reduce(
          (row, x) => ({
            ...row,
            ...(x.channel === 'EMAIL' && row.email ? { email: { ...row.email, on: x.on } } : {}),
            ...(x.channel === 'PUSH' && row.push ? { push: { ...row.push, on: x.on } } : {}),
          }),
          c,
        ),
    ),
    quietHours: change.quietHours ?? s.quietHours,
  };
}

function KindRow({
  row,
  wording,
  pushOn,
  onChoose,
}: {
  row: NotificationCategorySetting;
  wording: string;
  pushOn: boolean;
  onChoose: (category: string, channel: 'EMAIL' | 'PUSH', on: boolean) => void;
}) {
  const mark = MARK[row.category] ?? MARK.ACCOUNT;
  const channel = (which: 'PUSH' | 'EMAIL') => {
    const c = which === 'PUSH' ? row.push : row.email;
    if (!c) return null;
    const label = which === 'PUSH' ? 'Alert' : 'Email';
    return (
      <View style={styles.chan}>
        <Icon name={which === 'PUSH' ? 'notifications-outline' : 'mail-outline'} size={15} color={theme.ink2} />
        <Text style={styles.chanText}>{label}</Text>
        {c.locked ? (
          <View style={styles.lock} accessibilityLabel={c.locked}>
            <Icon name="lock-closed" size={14} color={theme.muted} />
          </View>
        ) : (
          <AppSwitch
            value={c.on}
            accessibilityLabel={`${row.title} by ${label.toLowerCase()}`}
            style={styles.switch}
            onValueChange={(on) => onChoose(row.category, which, on)}
          />
        )}
      </View>
    );
  };
  return (
    <View style={[styles.kind, row.needsYes && styles.kindNews]}>
      <View style={styles.kindHead}>
        <View style={[styles.mark, { backgroundColor: mark.bg }]}>
          <Icon name={mark.icon} size={17} color={mark.fg} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.rowTitle}>{row.title}</Text>
          <Text style={type.small}>{row.hint}</Text>
          {row.email?.locked && <Text style={styles.locked}>{row.email.locked}</Text>}
          {row.needsYes && <Text style={styles.consent}>Turning these on means: “{wording}”</Text>}
          {row.push?.on && !pushOn && Platform.OS !== 'web' && (
            <Text style={styles.hintOff}>Alerts are off on this phone — turn them on above.</Text>
          )}
        </View>
      </View>
      <View style={styles.chans}>
        {channel('PUSH')}
        {channel('EMAIL')}
      </View>
    </View>
  );
}

/** Alerts on this phone: on, not yet asked, or turned off in the phone's settings. */
function PhoneAlerts({ state, onTurnOn }: { state: PushState | null; onTurnOn: () => void }) {
  const words: Record<PushState, { title: string; line: string }> = {
    on: { title: 'Alerts are on', line: 'Bookings, reminders and messages reach you even when the app is closed.' },
    undecided: {
      title: 'Turn on alerts',
      line: 'Hear the moment a booking is confirmed, and get a reminder before it. You choose what below.',
    },
    denied: {
      title: 'Alerts are off for this app',
      line: 'They were turned off in your phone’s settings. Turn them on there, then come back.',
    },
    unavailable: {
      title: 'Alerts come on your phone',
      line: 'Open the app on your phone to turn alerts on. Here, everything is in your notifications.',
    },
  };
  const now = state ?? 'undecided';
  return (
    <View style={[styles.hero, now === 'on' && styles.heroOn]}>
      <View style={[styles.heroRing, now === 'on' && styles.heroRingOn]}>
        <Icon
          name={now === 'on' ? 'notifications' : 'notifications-outline'}
          size={24}
          color={now === 'on' ? theme.ok : theme.accent}
        />
      </View>
      <Text style={styles.heroTitle}>{words[now].title}</Text>
      <Text style={styles.heroLine}>{words[now].line}</Text>
      {now === 'undecided' && (
        <PressableScale onPress={onTurnOn} haptic style={styles.heroBtn} accessibilityRole="button">
          <Icon name="notifications" size={17} color="#FFFFFF" />
          <Text style={styles.heroBtnText}>Turn on alerts</Text>
        </PressableScale>
      )}
      {now === 'denied' && (
        <PressableScale
          onPress={() => void Linking.openSettings()}
          haptic
          style={[styles.heroBtn, styles.heroBtnQuiet]}
          accessibilityRole="button"
        >
          <Icon name="settings-outline" size={17} color={theme.ink} />
          <Text style={[styles.heroBtnText, { color: theme.ink }]}>Open the phone’s settings</Text>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  body: { alignSelf: 'center', gap: 6, paddingTop: 6 },
  flex: { flex: 1 },
  group: { fontFamily: font.bold, fontSize: 13, color: theme.muted, marginTop: 18, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: theme.panel, borderRadius: radius.lg, ...shadow.card, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginLeft: 16 },
  problem: { fontFamily: font.semibold, fontSize: 13, color: theme.danger, marginTop: 10 },

  hero: {
    alignItems: 'flex-start',
    gap: 6,
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: theme.panel,
    ...shadow.card,
  },
  heroOn: { backgroundColor: '#F2FBF5' },
  heroRing: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accentSoft,
    marginBottom: 6,
  },
  heroRingOn: { backgroundColor: theme.okSoft },
  heroTitle: { fontFamily: font.extrabold, fontSize: 19, color: theme.ink },
  heroLine: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: theme.ink2 },
  heroBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: theme.accent,
  },
  heroBtnQuiet: { backgroundColor: theme.sunken },
  heroBtnText: { fontFamily: font.extrabold, fontSize: 15, color: '#FFFFFF' },

  kind: { padding: 16, gap: 12 },
  kindNews: { backgroundColor: '#FFF7F3' },
  kindHead: { flexDirection: 'row', gap: 12 },
  mark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: font.bold, fontSize: 15.5, color: theme.ink, marginBottom: 2 },
  consent: { fontFamily: font.semibold, fontSize: 12.5, lineHeight: 18, color: theme.accentDeep, marginTop: 4 },
  hintOff: { fontFamily: font.semibold, fontSize: 12.5, color: theme.warn, marginTop: 4 },
  chans: { flexDirection: 'row', gap: 10, marginLeft: 50, maxWidth: 520 },
  chan: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 6,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: theme.sunken,
  },
  chanText: { flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: theme.ink2 },
  switch: { transform: [{ scale: 0.85 }] },
  lock: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: theme.panel,
  },
  locked: { fontFamily: font.semibold, fontSize: 12.5, color: theme.ink2, marginTop: 4 },

  follows: { marginHorizontal: 16, marginBottom: 14, marginLeft: 66, gap: 8 },
  follow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    paddingRight: 8,
    borderRadius: 14,
    backgroundColor: theme.sunken,
  },
  followName: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: theme.ink },
  unfollow: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: theme.panel },
  unfollowText: { fontFamily: font.bold, fontSize: 12.5, color: theme.ink2 },

  quiet: { padding: 16, gap: 14 },
  quietHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  moon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.night,
  },
  times: { flexDirection: 'row', gap: 10 },
  timesOff: { opacity: 0.45 },
  time: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: theme.sunken, gap: 2 },
  timeLabel: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  timeValue: { fontFamily: font.extrabold, fontSize: 20, color: theme.ink, fontVariant: ['tabular-nums'] },

  foot: {
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.muted,
    marginTop: 18,
    marginHorizontal: 4,
  },

  sheetList: { maxHeight: 360 },
  sheetBody: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 18, paddingBottom: 8 },
  sheetTime: {
    width: '22%',
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: theme.sunken,
  },
  sheetTimeOn: { backgroundColor: theme.accent },
  sheetTimeText: { fontFamily: font.bold, fontSize: 14, color: theme.ink, fontVariant: ['tabular-nums'] },
  sheetTimeTextOn: { color: '#FFFFFF' },
});
