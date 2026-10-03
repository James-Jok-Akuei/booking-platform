import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptLegal,
  listLegal,
  myLegalStatus,
  type LegalStatus,
} from '../src/api/auth';
import { tokens } from '../src/api/client';
import { theme } from '../src/theme';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * The documents, and what this person has agreed to (§122).
 *
 * Readable signed out. Somebody deciding whether to sign up has to be able to
 * read the terms first, and asking them to agree before they can read is both
 * the thing everybody complains about and the thing that would make the
 * agreement worth nothing.
 *
 * The Seller Agreement is filtered out: it binds businesses, it is shown in the
 * business app, and a customer reading it here would reasonably think it applied
 * to them.
 */
export default function Legal() {
  const signedIn = Boolean(tokens.access);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);

  // Signed in, the same list arrives with "and here is what you agreed to"
  // attached — one request rather than two that could disagree.
  const documents = useQuery({
    queryKey: ['legal', signedIn],
    queryFn: () => (signedIn ? myLegalStatus() : listLegal()),
  });

  const accept = useMutation({
    mutationFn: acceptLegal,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legal'] }),
  });

  const rows = (documents.data ?? []).filter((d) => d.kind !== 'SELLER_AGREEMENT');

  return (
    <>
      <Stack.Screen options={{ title: 'Legal' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {documents.isLoading && <ActivityIndicator color={theme.accent} />}

        {documents.data && rows.length === 0 && (
          <Text style={styles.empty}>Nothing has been published yet.</Text>
        )}

        {rows.map((document) => {
          const status = document as Partial<LegalStatus>;
          const expanded = open === document.id;
          return (
            <View key={document.id} style={styles.card}>
              <Pressable onPress={() => setOpen(expanded ? null : document.id)}>
                <Text style={styles.title}>{document.title}</Text>
                <Text style={styles.meta}>
                  Version {document.version} · {when(document.publishedAt)}
                </Text>

                {signedIn && status.acceptedVersion !== undefined && (
                  <Text style={status.needsAcceptance ? styles.todo : styles.done}>
                    {status.acceptedVersion === null
                      ? 'You have not agreed to this yet'
                      : status.needsAcceptance
                        ? `You agreed to version ${status.acceptedVersion}. This one is newer.`
                        : `Agreed ${status.acceptedAt ? when(status.acceptedAt) : ''}`}
                  </Text>
                )}

                {/* The one line that says what moved. Nobody rereads four
                    thousand words to find it. */}
                {status.needsAcceptance && document.changeNote && (
                  <Text style={styles.note}>What changed: {document.changeNote}</Text>
                )}

                <Text style={styles.toggle}>{expanded ? 'Hide' : 'Read it'}</Text>
              </Pressable>

              {expanded && <Text style={styles.body}>{document.body}</Text>}

              {signedIn && status.needsAcceptance && (
                <Pressable
                  style={styles.cta}
                  disabled={accept.isPending}
                  onPress={() => accept.mutate(document.id)}
                >
                  <Text style={styles.ctaText}>
                    {accept.isPending ? 'Saving…' : 'I agree to this'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <Text style={styles.foot}>
          Older versions are kept. What you agreed to stays as you read it, even
          after it is replaced.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12, paddingBottom: 30 },
  card: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 16,
    gap: 4,
  },
  title: { fontSize: 17, fontWeight: '700', color: theme.ink },
  meta: { color: theme.muted, fontSize: 12 },
  done: { color: theme.ok, fontSize: 13, marginTop: 4 },
  todo: { color: theme.warn, fontSize: 13, fontWeight: '600', marginTop: 4 },
  note: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  toggle: { color: theme.accent, fontWeight: '600', fontSize: 13, marginTop: 6 },
  body: { color: theme.ink, fontSize: 14, lineHeight: 21, marginTop: 8 },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { color: theme.muted, textAlign: 'center', padding: 28 },
  foot: { color: theme.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
