import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { deviceStore } from '../api/client';
import { listBanners } from '../api/notifications';
import { font, radius, theme } from '../theme';
import { FadeIn } from '../ui/FadeIn';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';

const KEY = 'booking.bannersClosed';

/**
 * A service notice from the platform's team across the top of Home (§287) —
 * "MTN MoMo is slow this morning" — until it ends or is closed. Seen signed
 * out too.
 */
export function NoticeBanner() {
  const router = useRouter();
  const banners = useQuery({ queryKey: ['banners'], queryFn: listBanners, refetchInterval: 5 * 60_000 });
  const [closed, setClosed] = useState<string[] | null>(null);
  useEffect(() => {
    void deviceStore
      .getItemAsync(KEY)
      .then((raw) => setClosed(raw ? (JSON.parse(raw) as string[]) : []))
      .catch(() => setClosed([]));
  }, []);
  if (closed === null) return null;
  const b = (banners.data?.banners ?? []).find((x) => !closed.includes(x.id));
  if (!b) return null;

  const close = () => {
    // Short ids, few kept: the phone's store holds a couple of kilobytes a value.
    const next = [...closed, b.id].slice(-12);
    setClosed(next);
    void deviceStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => undefined);
  };

  return (
    <FadeIn>
      <LinearGradient colors={['#2B352C', '#1F2A1F']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.mark}>
          <Icon name="megaphone" size={18} color="#FFB547" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>{b.title}</Text>
          <Text style={styles.body}>{b.body}</Text>
          {b.linkPath && (
            <PressableScale
              onPress={() => router.push(b.linkPath as never)}
              style={styles.link}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>{b.linkLabel || 'See more'}</Text>
              <Icon name="arrow-forward" size={14} color={theme.ink} />
            </PressableScale>
          )}
        </View>
        <PressableScale
          onPress={close}
          hitSlop={10}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Close this notice"
        >
          <Icon name="close" size={16} color="rgba(255,255,255,0.8)" />
        </PressableScale>
      </LinearGradient>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.lg },
  flex: { flex: 1, gap: 3 },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  title: { fontFamily: font.bold, fontSize: 14.5, color: '#FFFFFF' },
  body: { fontFamily: font.medium, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.82)' },
  link: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
  },
  linkText: { fontFamily: font.bold, fontSize: 12.5, color: theme.ink },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
