import { useState } from 'react';
import { useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAppointment } from '../../src/api/booking';
import { getMe } from '../../src/api/auth';
import {
  REVIEW_EDIT_WINDOW_DAYS,
  canStillEdit,
  createReview,
  updateReview,
} from '../../src/api/reviews';
import { ApiError } from '../../src/api/client';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { cheer, tick } from '../../src/ui/haptic';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { Skeleton } from '../../src/ui/Skeleton';
import { TopBar } from '../../src/ui/TopBar';

/** What each score means, so a tap is a sentence rather than a number. */
const MEANING = [
  'Bad',
  'Not good',
  'Fine',
  'Good',
  'Very good',
];

/**
 * Write or edit one review. The id in the route is the APPOINTMENT's.
 *
 * Keyed on the appointment rather than the review because that is the thing the
 * customer arrived from, and because a review that does not exist yet has no id
 * to route by. Whether this is a first review or an edit is decided by what the
 * appointment carries (§111), never by posting and reading the 409.
 */
export default function WriteReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();

  const appointment = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => getAppointment(id),
  });

  const existing = appointment.data?.review ?? null;
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // The name already on the account, so the field shows what people will
  // actually see rather than an empty box and a promise (§113.2). It is the
  // same `null means untouched` trick as the two fields above.
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const name = displayName ?? me.data?.displayName ?? '';

  // Null means "not touched yet", so the existing review shows through until
  // the customer actually changes something. Defaulting state from a query that
  // starts undefined would otherwise pin the form to an empty review.
  const score = rating ?? existing?.rating ?? 0;
  const text = comment ?? existing?.comment ?? '';

  const save = useMutation({
    mutationFn: () => {
      const trimmedName = name.trim();
      const body = {
        rating: score,
        comment: text.trim() || undefined,
        ...(trimmedName ? { displayName: trimmedName } : {}),
      };
      return existing
        ? updateReview(existing.id, body)
        : createReview(id, { ...body, rating: score });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointment', id] });
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      // The shop page and the listing both carry a rating this just moved.
      queryClient.invalidateQueries({ queryKey: ['shop'] });
      queryClient.invalidateQueries({ queryKey: ['discover'] });
      cheer();
      router.back();
    },
    onError: (error) =>
      Alert.alert(
        'Could not save that',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (appointment.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title="Write a review" />
        <View style={styles.content}>
          <Skeleton height={86} round={radius.lg} />
          <Skeleton height={320} round={radius.xl} />
        </View>
      </View>
    );
  }

  const a = appointment.data;
  if (!a) {
    return (
      <View style={styles.screen}>
        <TopBar title="Write a review" />
        <EmptyState
          icon="calendar-outline"
          title="That booking could not be found."
          text="If you have signed out, sign in again and open it from My bookings."
        />
      </View>
    );
  }

  // Both refusals come from the server too. They are repeated here so the screen
  // can explain instead of offering a control and then showing an error.
  if (a.status !== 'COMPLETED') {
    return (
      <View style={styles.screen}>
        <TopBar title="Write a review" />
        <EmptyState
          icon="hourglass-outline"
          title="Not yet"
          text={`A visit can be reviewed once the shop has marked it done. This one is still ${
            a.status === 'BOOKED' ? 'booked' : 'not finished'
          }.`}
        />
      </View>
    );
  }

  const locked = existing !== null && !canStillEdit(existing.createdAt);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // Padding on BOTH platforms (§166). Android used to resize the window
      // for the keyboard by itself, which is why this was left undefined
      // there; with edge-to-edge screens that resize no longer happens, and
      // the composer sat under the keyboard.
      behavior="padding"
    >
      <TopBar title={existing ? 'Your review' : 'Write a review'} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { width: layout.contentWidth }]}
      >
        <FadeIn style={[styles.card, styles.about]}>
          <View style={styles.aboutIcon}>
            <Icon name="storefront-outline" size={20} color={theme.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.aboutTitle}>{a.service.name}</Text>
            <Text style={type.small}>
              {a.location.name} · {a.location.address}
            </Text>
          </View>
        </FadeIn>

        <FadeIn delay={70} style={styles.card}>
          <Text style={[type.title, styles.centre]}>How was it?</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((value) => (
              <StarButton
                key={value}
                on={value <= score}
                disabled={locked}
                label={`${value} out of 5 — ${MEANING[value - 1]}`}
                onPress={() => setRating(value)}
              />
            ))}
          </View>
          {/* Always takes a line, so the form below does not jump when the
              first star is tapped. */}
          <Text style={[styles.meaning, styles.centre]}>
            {score > 0 ? MEANING[score - 1] : ' '}
          </Text>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setComment}
            editable={!locked}
            multiline
            maxLength={2000}
            placeholder="What happened? (optional)"
            placeholderTextColor={theme.muted}
          />

          {!locked && (
            <>
              <Text style={type.label}>The name to show</Text>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setDisplayName}
                maxLength={40}
                autoCapitalize="words"
                placeholder="Anonymous"
                placeholderTextColor={theme.muted}
              />
              {/* The name lives on the account, not on the review. Saying so
                  matters: filling this in rewrites the byline on every review
                  this person has ever left, which is intended and surprising. */}
              <Text style={type.small}>
                {me.data?.displayName
                  ? 'This is the name on all of your reviews. Changing it here changes it on every one of them.'
                  : 'Leave this blank to stay Anonymous. Whatever you put here becomes the name on all of your reviews.'}
              </Text>
            </>
          )}
        </FadeIn>

        {existing && (
          <Text style={[type.small, styles.centre]}>
            {locked
              ? `A review can be changed for ${REVIEW_EDIT_WINDOW_DAYS} days after posting. That time has passed, so this one now stands as it is.`
              : `You can change this for ${REVIEW_EDIT_WINDOW_DAYS} days after posting.`}
          </Text>
        )}
      </ScrollView>

      {!locked && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
          <Button
            disabled={score === 0}
            busy={save.isPending}
            label={existing ? 'Save changes' : score === 0 ? 'Pick a rating' : 'Post review'}
            onPress={() => save.mutate()}
            style={{ width: Math.min(layout.contentWidth - 40, 520), alignSelf: 'center' }}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/**
 * One star you can tap. It jumps when it lights (§133), so choosing four stars
 * is four small jumps in a row rather than five shapes changing colour at once.
 */
function StarButton({
  on,
  disabled,
  label,
  onPress,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!on) return;
    scale.setValue(0.6);
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 16,
    }).start();
  }, [on, scale]);

  return (
    <Pressable
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tick();
        onPress();
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={on ? 'star' : 'star-outline'} size={44} color={on ? theme.star : theme.line} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  centre: { textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24, gap: 16, alignSelf: 'center' },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 20,
    gap: 12,
    ...shadow.card,
  },
  about: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16 },
  aboutIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutTitle: { fontFamily: font.bold, fontSize: 16, color: theme.ink, marginBottom: 1 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 2 },
  meaning: { fontFamily: font.bold, fontSize: 15, color: theme.ink },
  input: {
    fontFamily: font.medium,
    backgroundColor: theme.sunken,
    borderRadius: radius.lg,
    padding: 15,
    fontSize: 15,
    lineHeight: 21,
    color: theme.ink,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  nameInput: {
    fontFamily: font.semibold,
    backgroundColor: theme.sunken,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    height: 50,
    paddingVertical: 0,
    fontSize: 15,
    color: theme.ink,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: theme.panel,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.float,
  },
});
