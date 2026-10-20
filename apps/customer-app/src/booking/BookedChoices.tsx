import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Appointment } from '../api/booking';
import { font, radius, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { Sheet } from '../ui/Sheet';
import { ChoicePicker, NoteBox } from './ChoicePicker';
import { toggle, type ChoiceGroup } from './choices';

type Pick = NonNullable<Appointment['choices']>[number];

/**
 * What the customer picked (§300), as the booking keeps it: each answer by
 * its question, with what it added; the private answers apart, with a lock;
 * and the note. Read from the booking's own copy — a shop changing its
 * questions later never changes this.
 */
export function BookedChoices({
  a,
  format,
  onChange,
}: {
  a: Appointment;
  format: (minor: number | null | undefined, currency?: string) => string;
  /** Offered while wishes can still change (§300.7). */
  onChange?: () => void;
}) {
  const picks = (a.choices ?? []) as Pick[];
  const privateOnes = a.healthChoices ?? [];
  if (picks.length === 0 && privateOnes.length === 0 && !a.customerNote && !a.healthChoicesRemovedAt) return null;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={[type.subheading, styles.flex]}>Your choices</Text>
        {onChange && (
          <PressableScale haptic scaleTo={0.95} onPress={onChange} accessibilityRole="button" style={styles.change}>
            <Icon name="create-outline" size={14} color={theme.accentDeep} />
            <Text style={styles.changeText}>Change</Text>
          </PressableScale>
        )}
      </View>

      {picks.map((pick) => (
        <View key={pick.optionId} style={styles.row}>
          <View style={styles.flex}>
            <Text style={type.tiny}>{pick.group}</Text>
            <Text style={styles.answer}>{pick.option}</Text>
          </View>
          {(pick.priceMinor !== 0 || pick.extraMinutes > 0) && (
            <Text style={styles.adds}>
              {[
                pick.priceMinor > 0 && `+${format(pick.priceMinor, a.currency)}`,
                pick.priceMinor < 0 && `−${format(-pick.priceMinor, a.currency)}`,
                pick.extraMinutes > 0 && `+${pick.extraMinutes} min`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </View>
      ))}

      {/* Private answers (§300.6): for the shop, and never in a message. */}
      {privateOnes.length > 0 && (
        <View style={styles.private}>
          <Icon name="lock-closed" size={14} color={theme.danger} />
          <View style={styles.flex}>
            <Text style={styles.privateLabel}>Private, for the shop only</Text>
            <Text style={styles.privateText}>
              {groupLines(privateOnes)
                .map(([group, options]) => `${group}: ${options.join(', ')}`)
                .join(' · ')}
            </Text>
          </View>
        </View>
      )}
      {a.healthChoicesRemovedAt && (
        <Text style={type.tiny}>Private answers were removed 30 days after the visit, as promised.</Text>
      )}

      {a.customerNote && (
        <View style={styles.note}>
          <Icon name="chatbox-ellipses-outline" size={14} color={theme.ink2} />
          <Text style={styles.noteText}>“{a.customerNote}”</Text>
        </View>
      )}
    </View>
  );
}

/** "Allergies: Nuts, Latex", one per question, in order. */
function groupLines(picks: Pick[]): Array<[string, string[]]> {
  const byGroup = new Map<string, string[]>();
  for (const pick of picks) byGroup.set(pick.group, [...(byGroup.get(pick.group) ?? []), pick.option]);
  return [...byGroup.entries()];
}

/**
 * Changing wishes after booking (§300.7): the questions whose answers change
 * neither the price nor the time, as the shop asks them now, and the note.
 * Everything else stays as booked — said here, so nobody looks for it.
 */
export function ChangeChoicesSheet({
  open,
  onClose,
  a,
  wishes,
  noteEnabled,
  notePrompt,
  busy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  a: Appointment;
  /** The service's wish questions, as it asks them now. */
  wishes: ChoiceGroup[];
  noteEnabled: boolean;
  notePrompt: string;
  busy: boolean;
  onSave: (input: { optionIds: string[]; note: string | null }) => void;
}) {
  const startPicked = () => {
    const now = new Set(wishes.flatMap((g) => g.options.map((o) => o.id)));
    return new Set(
      [...((a.choices ?? []) as Pick[]), ...(a.healthChoices ?? [])]
        .map((pick) => pick.optionId)
        .filter((id) => now.has(id)),
    );
  };
  const [picked, setPicked] = useState<Set<string>>(startPicked);
  const [note, setNote] = useState(a.customerNote ?? '');
  const fixed = ((a.choices ?? []) as Pick[]).filter((pick) => pick.priceMinor !== 0 || pick.extraMinutes > 0);
  const missing = wishes.filter(
    (g) => g.required && (!g.showIfOptionId || picked.has(g.showIfOptionId)) && !g.options.some((o) => picked.has(o.id)),
  );

  return (
    <Sheet open={open} onClose={onClose} title="Change your wishes">
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        <Text style={type.small}>
          Until 2 hours before, as often as you like. The shop is told something changed.
        </Text>
        {wishes.length > 0 && (
          <ChoicePicker
            groups={wishes}
            picked={picked}
            onToggle={(group, option) => setPicked((was) => toggle(wishes, was, group, option))}
            format={(minor) => String(minor)}
            flagMissing
          />
        )}
        {noteEnabled && (
          <NoteBox
            value={note}
            onChange={setNote}
            prompt={notePrompt}
            privateAsked={wishes.some((g) => g.healthRelated)}
          />
        )}
        {fixed.length > 0 && (
          <View style={styles.fixed}>
            <Icon name="lock-closed-outline" size={14} color={theme.muted} />
            <Text style={[type.small, styles.flex]}>
              {fixed.map((pick) => `“${pick.option}”`).join(' and ')}{' '}
              {fixed.length === 1
                ? 'stays as booked: it changed the price or the time.'
                : 'stay as booked: they changed the price or the time.'}
            </Text>
          </View>
        )}
      </ScrollView>
      <Button
        label={missing.length > 0 ? 'Answer the questions' : 'Save changes'}
        busy={busy}
        disabled={missing.length > 0}
        onPress={() =>
          onSave({
            optionIds: wishes.flatMap((g) =>
              !g.showIfOptionId || picked.has(g.showIfOptionId) ? g.options.filter((o) => picked.has(o.id)).map((o) => o.id) : [],
            ),
            note: noteEnabled ? note.trim() || null : null,
          })
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 15,
    backgroundColor: theme.accentSoft,
  },
  changeText: { fontFamily: font.bold, fontSize: 12.5, color: theme.accentDeep },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  answer: { fontFamily: font.bold, fontSize: 14.5, lineHeight: 20, color: theme.ink },
  adds: { fontFamily: font.bold, fontSize: 13, color: theme.ink2 },
  private: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: theme.dangerSoft,
  },
  privateLabel: { fontFamily: font.bold, fontSize: 11.5, color: theme.danger, letterSpacing: 0.3 },
  privateText: { fontFamily: font.semibold, fontSize: 13.5, lineHeight: 19, color: '#8F2219', marginTop: 1 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: theme.sunken,
  },
  noteText: { flex: 1, fontFamily: font.mediumItalic, fontSize: 13.5, lineHeight: 19, color: theme.ink2 },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { gap: 16, paddingBottom: 16 },
  fixed: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});
