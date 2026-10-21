import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptLegal, myLegalStatus } from '../api/auth';
import { useSignedIn } from '../api/client';
import { font, radius, shadow, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { TranslationNote } from './TranslationNote';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

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
  const signedIn = useSignedIn();

  const documents = useQuery({
    queryKey: ['legal-status'],
    queryFn: () => myLegalStatus(),
    enabled: signedIn,
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
    <Modal transparent animationType="fade" visible statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.disc}>
            <Icon name="document-text-outline" size={24} color={theme.accent} />
          </View>
          <Text style={type.heading}><Trans>{document.title} has changed</Trans></Text>
          <Text style={type.small}>
            <Trans>You agreed to version {document.acceptedVersion}. This is version {document.version}.</Trans>
          </Text>

          {document.changeNote && (
            <View style={styles.noteBox}>
              <Text style={type.label}><Trans>What changed</Trans></Text>
              <Text style={type.body}>{document.changeNote}</Text>
            </View>
          )}

          {/* The English one tap away on the Legal page (§308.5). */}
          {document.language !== 'en' && <TranslationNote english={false} />}

          <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.body}>{document.body}</Text>
          </ScrollView>

          <Button
            busy={accept.isPending}
            label={accept.isPending ? t`Saving…` : t`I agree`}
            onPress={() => accept.mutate(document)}
          />

          <View style={styles.footRow}>
            <PressableScale
              hitSlop={8}
              onPress={() => {
                setDismissed(true);
                router.push('/legal');
              }}
            >
              <Text style={styles.link}><Trans>Read all the documents</Trans></Text>
            </PressableScale>
            {/* Leaving it for later is allowed, and it comes back next time the
                app opens. Nothing here is blocked by not agreeing. */}
            <PressableScale hitSlop={8} onPress={() => setDismissed(true)} testID="legal-later">
              <Text style={styles.later}><Trans>Not now</Trans></Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(18,20,26,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 22,
    gap: 10,
    maxHeight: '85%',
    ...shadow.float,
  },
  disc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  noteBox: {
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 13,
    gap: 4,
    marginTop: 2,
  },
  bodyScroll: { maxHeight: 240 },
  body: { fontFamily: font.regular, color: theme.ink2, fontSize: 14, lineHeight: 21.5 },
  // Long words (§308): "Not now" goes under the link rather than off the card.
  footRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 16, rowGap: 8, marginTop: 4 },
  link: { fontFamily: font.bold, color: theme.accent, fontSize: 13.5 },
  later: { fontFamily: font.semibold, color: theme.muted, fontSize: 13.5 },
});
