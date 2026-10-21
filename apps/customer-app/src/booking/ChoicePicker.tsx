import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { font, radius, theme, type } from '../theme';
import { Icon } from '../ui/Icon';
import { useLayout } from '../ui/layout';
import { PopIn } from '../ui/Motion';
import { PressableScale } from '../ui/PressableScale';
import { addsWords, askedAs, limitWords, shows, type ChoiceGroup, type ChoiceOption } from './choices';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/**
 * The questions a shop asks while booking (§300), answered by tapping:
 * pick one is a round mark, pick several a square one; what an answer adds
 * is said beside it; an answer the shop has paused is greyed and says so.
 *
 * A question that hangs on an answer pops in when that answer is picked.
 * Health and other private questions say who sees them — the shop, and
 * nobody else, never in an email (§300.6).
 */
export function ChoicePicker({
  groups,
  picked,
  onToggle,
  format,
  flagMissing = false,
}: {
  groups: ChoiceGroup[];
  picked: ReadonlySet<string>;
  onToggle: (group: ChoiceGroup, option: ChoiceOption) => void;
  format: (minor: number) => string;
  /** Mark unanswered required questions, after a try to go on without them. */
  flagMissing?: boolean;
}) {
  // Two answers to a row on a tablet, where one would stretch across the page.
  const wide = useLayout().wide;
  return (
    <View style={styles.list}>
      {groups.map((group) => {
        if (!shows(group, picked)) return null;
        const answered = group.options.some((option) => picked.has(option.id));
        const needed = group.required && !answered;
        const body = (
          <>
            <View style={styles.head}>
              <Text style={[type.subheading, styles.flex]}>{askedAs(group)}</Text>
              {group.required ? (
                answered ? (
                  <View style={[styles.badge, styles.badgeDone]}>
                    <Icon name="checkmark" size={12} color={theme.ok} />
                    <Text style={[styles.badgeText, styles.badgeTextDone]}><Trans>Done</Trans></Text>
                  </View>
                ) : (
                  <View style={[styles.badge, styles.badgeNeed]}>
                    <Text style={[styles.badgeText, styles.badgeTextNeed]}><Trans>Required</Trans></Text>
                  </View>
                )
              ) : (
                <Text style={styles.limit}>{limitWords(group)}</Text>
              )}
            </View>
            {group.required && <Text style={styles.limitUnder}>{limitWords(group)}</Text>}

            {group.healthRelated && (
              <View style={styles.private}>
                <Icon name="lock-closed" size={13} color={theme.danger} />
                <Text style={styles.privateText}>
                  <Trans>Private: only the shop sees this — never in a message or an email.</Trans>
                </Text>
              </View>
            )}

            <View style={[styles.options, wide && styles.optionsWide]}>
              {group.options.map((option) => {
                const on = picked.has(option.id);
                const adds = group.healthRelated ? null : addsWords(option, format);
                const paused = !option.available && !on;
                return (
                  <PressableScale
                    key={option.id}
                    haptic={!paused}
                    scaleTo={paused ? 1 : 0.97}
                    disabled={paused}
                    onPress={() => onToggle(group, option)}
                    accessibilityRole={group.kind === 'ONE' ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: on, disabled: paused }}
                    accessibilityLabel={[option.label, adds, paused ? t`not available now` : null].filter(Boolean).join(', ')}
                    style={[styles.option, wide && styles.optionWide, on && styles.optionOn, paused && styles.optionPaused]}
                  >
                    <View
                      style={[
                        styles.mark,
                        group.kind === 'MANY' && styles.markSquare,
                        on && styles.markOn,
                      ]}
                    >
                      {on && <Icon name="checkmark" size={13} color="#FFFFFF" />}
                    </View>
                    <View style={styles.flex}>
                      <Text style={[styles.label, paused && styles.labelPaused]}>{option.label}</Text>
                      {option.description && <Text style={styles.description}>{option.description}</Text>}
                    </View>
                    {paused ? (
                      <Text style={styles.paused}><Trans>Not available now</Trans></Text>
                    ) : (
                      adds && <Text style={[styles.adds, on && styles.addsOn]}>{adds}</Text>
                    )}
                  </PressableScale>
                );
              })}
            </View>
          </>
        );
        const look = [styles.group, needed && flagMissing && styles.groupNeeded];
        // A question that hangs on an answer pops in when it is picked.
        return group.showIfOptionId ? (
          <PopIn key={group.id} style={look}>
            {body}
          </PopIn>
        ) : (
          <View key={group.id} style={look}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

/**
 * A short note to the shop (§300.5), folded away until wanted: most
 * bookings need none, and an open empty box asks for one.
 */
export function NoteBox({
  value,
  onChange,
  prompt,
  privateAsked,
  onFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  prompt: string;
  /** The service asks private questions: allergies belong there, not here. */
  privateAsked: boolean;
  onFocus?: () => void;
}) {
  const [open, setOpen] = useState(value.length > 0);
  if (!open) {
    return (
      <PressableScale
        haptic
        scaleTo={0.98}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={styles.noteClosed}
      >
        <View style={styles.noteIcon}>
          <Icon name="create-outline" size={16} color={theme.ink2} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.noteTitle}><Trans>Add a note for the shop</Trans></Text>
          <Text style={type.small} numberOfLines={1}>
            {prompt}
          </Text>
        </View>
        <Icon name="add" size={20} color={theme.muted} />
      </PressableScale>
    );
  }
  return (
    <View style={styles.note}>
      <View style={styles.noteHead}>
        <Text style={[type.subheading, styles.flex]}><Trans>A note for the shop</Trans></Text>
        <Text style={styles.count}>{value.length}/250</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        multiline
        maxLength={250}
        autoFocus={value.length === 0}
        placeholder={prompt}
        placeholderTextColor={theme.muted}
        style={styles.noteInput}
        textAlignVertical="top"
      />
      <Text style={type.tiny}>
        <Trans>A request, not a promise — the shop will try.</Trans>
      {privateAsked ? t` Allergies and health go in the questions above, never here.` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 18 },
  group: { gap: 8, borderRadius: radius.md },
  groupNeeded: {
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: theme.accentSoft,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  limit: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  limitUnder: { fontFamily: font.semibold, fontSize: 12, color: theme.muted, marginTop: -6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
  },
  badgeNeed: { backgroundColor: theme.accentSoft },
  badgeDone: { backgroundColor: theme.okSoft },
  badgeText: { fontFamily: font.bold, fontSize: 11.5 },
  badgeTextNeed: { color: theme.accentDeep },
  badgeTextDone: { color: theme.ok },
  private: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  privateText: { flex: 1, fontFamily: font.semibold, fontSize: 12, lineHeight: 16, color: theme.danger },
  options: { gap: 8 },
  optionsWide: { flexDirection: 'row', flexWrap: 'wrap' },
  optionWide: { flexBasis: '45%', flexGrow: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: theme.line,
    backgroundColor: theme.panel,
  },
  optionOn: { borderColor: theme.accent, backgroundColor: '#FFF6F2' },
  optionPaused: { backgroundColor: theme.sunken, borderColor: theme.sunken },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D9D5CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markSquare: { borderRadius: 7 },
  markOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  label: { fontFamily: font.bold, fontSize: 14.5, lineHeight: 20, color: theme.ink },
  labelPaused: { color: theme.muted },
  description: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 17, color: theme.muted, marginTop: 1 },
  adds: { fontFamily: font.bold, fontSize: 12.5, color: theme.ink2 },
  addsOn: { color: theme.accentDeep },
  paused: { fontFamily: font.semibold, fontSize: 11.5, color: theme.muted },

  noteClosed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: theme.sunken,
  },
  noteIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteTitle: { fontFamily: font.bold, fontSize: 14, color: theme.ink },
  note: { gap: 8 },
  noteHead: { flexDirection: 'row', alignItems: 'center' },
  count: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  noteInput: {
    minHeight: 92,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: theme.line,
    backgroundColor: theme.panel,
    fontFamily: font.medium,
    fontSize: 14.5,
    lineHeight: 20,
    color: theme.ink,
  },
});
