import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptLegal, myLegalStatus } from '../api/auth';
import { tokens } from '../api/client';
import { theme } from '../theme';

/**
 * Shown when something somebody already agreed to has been replaced (§126.3).
 *
 * **Not dismissible, and not a wall.** There is no close button, because a
 * notice that can be swiped away is one nobody reads — but it also blocks
 * nothing: the customer can read the document, agree, or leave it for later by
 * tapping "Not now", and everything in the app keeps working either way.
 *
 * That asymmetry is deliberate. Stopping somebody mid-booking over a wording
 * change would cost them the slot they were about to take, and the acceptance
 * that matters most — a business putting a service in front of customers — is
 * gated on the SERVER (§126) where it cannot be skipped.
 *
 * The change note is shown before the document. Nobody rereads four thousand
 * words to find the sentence that moved.
 */
export function LegalPrompt() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const documents = useQuery({
    queryKey: ['legal-status'],
    queryFn: myLegalStatus,
    enabled: Boolean(tokens.access),
    // The answer changes only when an admin publishes, which is rare. Asking on
    // every screen would be a request per navigation for a notice that is almost
    // always "nothing to say".
    staleTime: 10 * 60 * 1000,
  });

  const accept = useMutation({
    mutationFn: acceptLegal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legal-status'] });
      queryClient.invalidateQueries({ queryKey: ['legal'] });
    },
  });

  // Only documents they had ALREADY agreed to an older version of. Somebody who
  // has never agreed to anything is a brand-new account, and §126.1 recorded
  // their acceptance as they registered — prompting them would be asking twice.
  const changed = (documents.data ?? []).filter(
    (d) => d.needsAcceptance && d.acceptedVersion !== null,
  );
  const document = changed[0];

  if (!document || dismissed) return null;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{document.title} has changed</Text>
          <Text style={styles.meta}>
            You agreed to version {document.acceptedVersion}. This is version{' '}
            {document.version}.
          </Text>

          {document.changeNote && (
            <View style={styles.noteBox}>
              <Text style={styles.noteLabel}>What changed</Text>
              <Text style={styles.note}>{document.changeNote}</Text>
            </View>
          )}

          <ScrollView style={styles.bodyScroll}>
            <Text style={styles.body}>{document.body}</Text>
          </ScrollView>

          <Pressable
            style={styles.cta}
            disabled={accept.isPending}
            onPress={() => accept.mutate(document.id)}
          >
            <Text style={styles.ctaText}>
              {accept.isPending ? 'Saving…' : 'I agree'}
            </Text>
          </Pressable>

          <View style={styles.footRow}>
            <Pressable
              onPress={() => {
                setDismissed(true);
                router.push('/legal');
              }}
            >
              <Text style={styles.link}>Read all the documents</Text>
            </Pressable>
            {/* Leaving it for later is allowed, and it comes back next time the
                app opens. Nothing here is blocked by not agreeing. */}
            <Pressable onPress={() => setDismissed(true)}>
              <Text style={styles.later}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16,25,29,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: theme.panel,
    borderRadius: 14,
    padding: 20,
    gap: 8,
    maxHeight: '85%',
  },
  title: { fontSize: 19, fontWeight: '700', color: theme.ink },
  meta: { color: theme.muted, fontSize: 13 },
  noteBox: {
    backgroundColor: theme.bg,
    borderRadius: theme.radius,
    padding: 12,
    gap: 2,
    marginTop: 4,
  },
  noteLabel: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  note: { color: theme.ink, fontSize: 14, lineHeight: 20 },
  bodyScroll: { marginTop: 6, maxHeight: 260 },
  body: { color: theme.ink, fontSize: 14, lineHeight: 21 },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  link: { color: theme.accent, fontWeight: '600', fontSize: 13 },
  later: { color: theme.muted, fontSize: 13 },
});
