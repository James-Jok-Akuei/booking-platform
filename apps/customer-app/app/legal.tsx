import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  acceptLegal,
  listLegal,
  myLegalStatus,
  type LegalStatus,
} from '../src/api/auth';
import { useSignedIn } from '../src/api/client';
import { font, radius, shadow, theme, type } from '../src/theme';
import { Button } from '../src/ui/Button';
import { EmptyState } from '../src/ui/EmptyState';
import { FadeIn } from '../src/ui/FadeIn';
import { Icon } from '../src/ui/Icon';
import { useLayout } from '../src/ui/layout';
import { Pill } from '../src/ui/Pill';
import { PressableScale } from '../src/ui/PressableScale';
import { RowSkeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';

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
  const signedIn = useSignedIn();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
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
    <View style={styles.screen}>
      <TopBar title="Legal" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 30, width: layout.contentWidth },
        ]}
      >
        {documents.isLoading && (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}

        {documents.data && rows.length === 0 && (
          <EmptyState icon="document-text-outline" title="Nothing has been published yet." />
        )}

        {rows.map((document, index) => {
          const status = document as Partial<LegalStatus>;
          const expanded = open === document.id;
          return (
            <FadeIn key={document.id} index={index} style={styles.card}>
              <PressableScale
                scaleTo={0.99}
                onPress={() => setOpen(expanded ? null : document.id)}
                style={styles.head}
              >
                <View style={styles.disc}>
                  <Icon name="document-text-outline" size={20} color={theme.accent} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.title}>{document.title}</Text>
                  <Text style={type.small}>
                    Version {document.version} · {when(document.publishedAt)}
                  </Text>
                </View>
              </PressableScale>

              {signedIn && status.acceptedVersion !== undefined && (
                <Pill
                  tone={status.needsAcceptance ? 'warn' : 'ok'}
                  icon={status.needsAcceptance ? 'alert-circle-outline' : 'checkmark-circle'}
                  label={
                    status.acceptedVersion === null
                      ? 'You have not agreed to this yet'
                      : status.needsAcceptance
                        ? `You agreed to version ${status.acceptedVersion}. This one is newer.`
                        : `Agreed ${status.acceptedAt ? when(status.acceptedAt) : ''}`
                  }
                />
              )}

              {/* The one line that says what moved. Nobody rereads four
                  thousand words to find it. */}
              {status.needsAcceptance && document.changeNote && (
                <View style={styles.noteBox}>
                  <Text style={type.body}>What changed: {document.changeNote}</Text>
                </View>
              )}

              <PressableScale
                hitSlop={8}
                style={styles.toggleRow}
                onPress={() => setOpen(expanded ? null : document.id)}
              >
                <Text style={styles.toggle}>{expanded ? 'Hide' : 'Read it'}</Text>
                <Icon
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={theme.accent}
                />
              </PressableScale>

              {expanded && (
                <FadeIn distance={8}>
                  <Text style={styles.body}>{document.body}</Text>
                </FadeIn>
              )}

              {signedIn && status.needsAcceptance && (
                <Button
                  busy={accept.isPending}
                  label={accept.isPending ? 'Saving…' : 'I agree to this'}
                  onPress={() => accept.mutate(document.id)}
                />
              )}
            </FadeIn>
          );
        })}

        <Text style={[type.small, styles.foot]}>
          Older versions are kept. What you agreed to stays as you read it, even
          after it is replaced.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 14, alignSelf: 'center' },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
    ...shadow.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  disc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: font.bold, fontSize: 16.5, color: theme.ink, marginBottom: 1 },
  noteBox: { backgroundColor: theme.sunken, borderRadius: radius.md, padding: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  toggle: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent },
  body: { fontFamily: font.regular, color: theme.ink2, fontSize: 14.5, lineHeight: 22.5 },
  foot: { textAlign: 'center', paddingHorizontal: 10 },
});
