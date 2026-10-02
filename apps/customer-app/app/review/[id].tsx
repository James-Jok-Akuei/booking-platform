import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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
import { theme } from '../../src/theme';

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
      router.back();
    },
    onError: (error) =>
      Alert.alert(
        'Could not save that',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  // Every early return needs its own <Stack.Screen>, including this one: until
  // one renders, expo-router titles the header with the route's FILE name, so a
  // slow request showed "review/[id]" at the top of the screen.
  if (appointment.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Write a review' }} />
        <ActivityIndicator style={styles.spinner} color={theme.accent} />
      </>
    );
  }

  const a = appointment.data;
  if (!a) {
    return (
      <>
        {/* The title has to be set on THIS branch too. Returning before the
            <Stack.Screen> below leaves the header showing the route's file
            name — "review/[id]" — which is what the simulator showed. */}
        <Stack.Screen options={{ title: 'Write a review' }} />
        <View style={styles.screen}>
          <Text style={styles.empty}>
            That booking could not be found. If you have signed out, sign in
            again and open it from My bookings.
          </Text>
        </View>
      </>
    );
  }

  // Both refusals come from the server too. They are repeated here so the screen
  // can explain instead of offering a control and then showing an error.
  if (a.status !== 'COMPLETED') {
    return (
      <>
        <Stack.Screen options={{ title: 'Write a review' }} />
        <View style={styles.centre}>
          <Text style={styles.title}>Not yet</Text>
          <Text style={styles.muted}>
            A visit can be reviewed once the shop has marked it done. This one is
            still {a.status === 'BOOKED' ? 'booked' : 'not finished'}.
          </Text>
        </View>
      </>
    );
  }

  const locked = existing !== null && !canStillEdit(existing.createdAt);

  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Your review' : 'Write a review' }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.block}>
            <Text style={styles.title}>{a.service.name}</Text>
            <Text style={styles.muted}>
              {a.location.name} · {a.location.address}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>How was it?</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  disabled={locked}
                  onPress={() => setRating(value)}
                  hitSlop={6}
                >
                  <Text style={[styles.star, value <= score && styles.starOn]}>★</Text>
                </Pressable>
              ))}
            </View>
            {score > 0 && <Text style={styles.meaning}>{MEANING[score - 1]}</Text>}

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
                <Text style={styles.label}>The name to show</Text>
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
                <Text style={styles.note}>
                  {me.data?.displayName
                    ? 'This is the name on all of your reviews. Changing it here changes it on every one of them.'
                    : 'Leave this blank to stay Anonymous. Whatever you put here becomes the name on all of your reviews.'}
                </Text>
              </>
            )}
          </View>

          {existing && (
            <Text style={styles.note}>
              {locked
                ? `A review can be changed for ${REVIEW_EDIT_WINDOW_DAYS} days after posting. That time has passed, so this one now stands as it is.`
                : `You can change this for ${REVIEW_EDIT_WINDOW_DAYS} days after posting.`}
            </Text>
          )}
        </ScrollView>

        {!locked && (
          <View style={styles.footer}>
            <Pressable
              style={[styles.cta, (score === 0 || save.isPending) && styles.ctaOff]}
              disabled={score === 0 || save.isPending}
              onPress={() => save.mutate()}
            >
              <Text style={styles.ctaText}>
                {save.isPending
                  ? 'Saving…'
                  : existing
                    ? 'Save changes'
                    : score === 0
                      ? 'Pick a rating'
                      : 'Post review'}
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12 },
  spinner: { marginTop: 40 },
  block: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 16,
    gap: 7,
  },
  title: { fontSize: 18, fontWeight: '700', color: theme.ink },
  heading: { fontWeight: '700', color: theme.ink, fontSize: 16 },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  stars: { flexDirection: 'row', gap: 8, marginTop: 2 },
  star: { fontSize: 38, color: theme.line },
  starOn: { color: '#f0a202' },
  meaning: { color: theme.ink, fontWeight: '600' },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 13,
    fontSize: 15,
    color: theme.ink,
    minHeight: 110,
    textAlignVertical: 'top',
    marginTop: 6,
  },
  label: { color: theme.ink, fontWeight: '600', fontSize: 13, marginTop: 6 },
  nameInput: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    color: theme.ink,
  },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    backgroundColor: theme.panel,
  },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaOff: { backgroundColor: theme.line },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { color: theme.muted, textAlign: 'center', padding: 28 },
});
