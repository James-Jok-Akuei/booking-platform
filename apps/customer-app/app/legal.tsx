import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  acceptLegal,
  listLegal,
  myLegalStatus,
  type LegalStatus,
} from '../src/api/auth';
import { useSignedIn } from '../src/api/client';
import { LegalText } from '../src/components/LegalText';
import { TranslationNote } from '../src/components/TranslationNote';
import { radius, shadow, theme, type } from '../src/theme';
import { AgreeButton } from '../src/ui/AgreeButton';
import { EmptyState } from '../src/ui/EmptyState';
import { FadeIn } from '../src/ui/FadeIn';
import { useLayout } from '../src/ui/layout';
import { Pill } from '../src/ui/Pill';
import { Segmented } from '../src/ui/Segmented';
import { RowSkeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';
import { showProblem } from '../src/ui/Dialog';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { formatDate } from '../src/i18n/format';

const when = (iso: string) =>
  formatDate(new Date(iso), { dateStyle: 'medium' });

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
 *
 * Laid out as a reader (§142): the documents are tabs on one line, the chosen
 * one is open in full — nothing to expand — a thin line under the tabs fills
 * as it is read, and the agreement is a bar fixed at the bottom, so the button
 * is always where the thumb is and never three screens below the text.
 */
export default function Legal() {
  const signedIn = useSignedIn();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [chosen, setChosen] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  /** How far the open document can scroll; what "read to the end" is measured against. */
  const [sizes, setSizes] = useState({ content: 0, view: 0 });
  const [atEnd, setAtEnd] = useState(false);
  // "Read the English" (§308.5): the English applies wherever a translation differs.
  const [english, setEnglish] = useState(false);

  // Signed in, the same list arrives with "and here is what you agreed to"
  // attached — one request rather than two that could disagree.
  const documents = useQuery({
    queryKey: ['legal', signedIn, english],
    queryFn: () => (signedIn ? myLegalStatus(english ? 'en' : undefined) : listLegal(english ? 'en' : undefined)),
    placeholderData: (previous) => previous,
  });

  const accept = useMutation({ mutationFn: acceptLegal });

  const rows = (documents.data ?? []).filter((d) => d.kind !== 'SELLER_AGREEMENT');
  const waiting = (d: (typeof rows)[number]) =>
    signedIn && (d as Partial<LegalStatus>).needsAcceptance === true;

  // Opens on the first document still waiting for an answer, if there is one:
  // that is what somebody sent here by a "the terms changed" banner came for.
  const current =
    rows.find((d) => d.id === chosen) ?? rows.find((d) => waiting(d)) ?? rows[0] ?? null;
  const status = (current ?? {}) as Partial<LegalStatus>;
  const asking = current !== null && waiting(current);

  // The bar rises when there is something to agree to, and leaves when not.
  useEffect(() => {
    Animated.spring(bar, {
      toValue: asking ? 1 : 0,
      useNativeDriver: true,
      speed: 12,
      bounciness: 7,
    }).start();
  }, [asking, bar]);

  // A different document starts from its top, unread.
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
    scrollY.setValue(0);
    setAtEnd(false);
  }, [current?.id, scrollY]);

  const reach = Math.max(1, sizes.content - sizes.view);
  const fits = sizes.content > 0 && sizes.content <= sizes.view + 8;
  const barWidth = Math.min(layout.width, layout.contentWidth);

  return (
    <View style={styles.screen}>
      <TopBar title={t`Legal`} />

      {rows.length > 1 && current && (
        <View style={[styles.tabs, { width: layout.contentWidth }]}>
          <Segmented
            value={current.id}
            onChange={setChosen}
            options={rows.map((d) => ({ value: d.id, label: d.title }))}
          />
        </View>
      )}

      {/* How much has been read. It fills, it never nags: the button below
          works at any point, because making someone scroll four thousand
          words to reach it proves they scrolled, not that they read. */}
      {current && (
        <View style={[styles.progressTrack, { width: barWidth }]}>
          <Animated.View
            style={[
              styles.progress,
              { width: barWidth },
              {
                transform: [
                  {
                    translateX: fits
                      ? 0
                      : scrollY.interpolate({
                          inputRange: [0, reach],
                          outputRange: [-barWidth, 0],
                          extrapolate: 'clamp',
                        }),
                  },
                ],
              },
            ]}
          />
        </View>
      )}

      <Animated.ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onLayout={(e) => {
          const view = e.nativeEvent.layout.height;
          setSizes((was) => ({ ...was, view }));
        }}
        onContentSizeChange={(_w, content) => setSizes((was) => ({ ...was, content }))}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
            if (!atEnd && e.nativeEvent.contentOffset.y >= reach - 24) setAtEnd(true);
          },
        })}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + (asking ? 150 : 30),
            width: layout.contentWidth,
          },
        ]}
      >
        {documents.isLoading && (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}

        {documents.data && rows.length === 0 && (
          <EmptyState icon="document-text-outline" title={t`Nothing has been published yet.`} />
        )}

        {current && (
          <FadeIn key={current.id} distance={10} style={styles.card}>
            <View style={styles.meta}>
              <Text style={type.title}>{current.title}</Text>
              <Text style={type.small}><Trans>Version {current.version} · {when(current.publishedAt)}</Trans>
              </Text>
            </View>

            {signedIn && status.acceptedVersion !== undefined && (
              <Pill
                tone={status.needsAcceptance ? 'warn' : 'ok'}
                icon={status.needsAcceptance ? 'alert-circle-outline' : 'checkmark-circle'}
                label={
                  status.acceptedVersion === null
                    ? t`You have not agreed to this yet`
                    : status.needsAcceptance
                      ? t`You agreed to version ${status.acceptedVersion}. This one is newer.`
                      : t`Agreed ${status.acceptedAt ? when(status.acceptedAt) : ''}`
                }
              />
            )}

            {/* The one line that says what moved. Nobody rereads four
                thousand words to find it. Only for someone who agreed to an
                earlier version — to anyone else nothing "changed". */}
            {status.needsAcceptance && status.acceptedVersion !== null && current.changeNote && (
              <View style={styles.noteBox}>
                <Text style={type.body}><Trans>What changed: {current.changeNote}</Trans></Text>
              </View>
            )}

            {(english || current.language !== 'en') && (
              <TranslationNote english={english} onToggle={() => setEnglish((was) => !was)} />
            )}

            <View style={styles.rule} />

            <LegalText body={current.body} />
          </FadeIn>
        )}

        {current && (
          <Text style={[type.small, styles.foot]}>
            <Trans>
              Older versions are kept. What you agreed to stays as you read it, even
              after it is replaced.
            </Trans>
          </Text>
        )}
      </Animated.ScrollView>

      {/* The agreement, fixed at the bottom. It says WHICH document and WHICH
          version in words, so the tap is to something named. */}
      <Animated.View
        pointerEvents={asking ? 'auto' : 'none'}
        style={[
          styles.bar,
          { paddingBottom: insets.bottom + 14 },
          {
            opacity: bar,
            transform: [{ translateY: bar.interpolate({ inputRange: [0, 1], outputRange: [140, 0] }) }],
          },
        ]}
      >
        {current && (
          <View style={[styles.barInner, { width: Math.min(layout.contentWidth, 560) }]}>
            <Text style={[type.small, styles.barText]}>
              <Trans>By tapping, you agree to version {current.version} of the {current.title}.</Trans>
            </Text>
            <AgreeButton
              // A fresh button per document: the one that just turned into a
              // tick must not be the one offered for the next document.
              key={current.id}
              label={t`I agree to this`}
              wake={atEnd || fits}
              onAgree={() => accept.mutateAsync(current).catch((error) => {
                showProblem(t`Not saved`, error);
                throw error;
              })}
              onDone={() => {
                // Straight on to the next one still waiting, if there is one —
                // two documents to accept should be two taps, not a hunt.
                const next = rows.find((d) => d.id !== current.id && waiting(d));
                queryClient.invalidateQueries({ queryKey: ['legal'] });
                if (next) setChosen(next.id);
              }}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  tabs: { alignSelf: 'center', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  progressTrack: {
    alignSelf: 'center',
    height: 3,
    backgroundColor: theme.line,
    overflow: 'hidden',
  },
  progress: { height: 3, backgroundColor: theme.accent, borderRadius: 2 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 14, alignSelf: 'center' },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 20,
    gap: 12,
    ...shadow.card,
  },
  meta: { gap: 2 },
  noteBox: { backgroundColor: theme.sunken, borderRadius: radius.md, padding: 12 },
  rule: { height: 1, backgroundColor: theme.line, marginVertical: 2 },
  foot: { textAlign: 'center', paddingHorizontal: 10 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    backgroundColor: theme.panel,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 14,
    paddingHorizontal: 20,
    ...shadow.float,
  },
  barInner: { maxWidth: '100%', gap: 10 },
  barText: { textAlign: 'center' },
});
