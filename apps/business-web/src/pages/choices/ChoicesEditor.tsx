import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getChoiceSuggestions,
  type ChoiceGroup,
  type ChoiceGroupInput,
  type ChoiceSuggestion,
} from '../../api/business';
import type { useMoney } from '../../money';
import { confirmDialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import './choices.css';

/**
 * Choices (§300): the questions a customer answers while booking this
 * service — hair length, car size, "no salt" — and what each answer adds to
 * the price and the time.
 *
 * Everything here is the form's own until "Save changes" or "Post" (§281):
 * customers see the questions only once the service is saved.
 */

type Money = ReturnType<typeof useMoney>;

/** The limits the server keeps (§300.1). */
export const MAX_GROUPS = 6;
export const MAX_OPTIONS = 12;

export type OptionDraft = {
  /** Stable inside the form; the server's id once saved. */
  key: string;
  id?: string;
  label: string;
  description: string;
  /** Major units, as typed, without a sign. */
  price: string;
  /** Takes money off rather than adding it ("I'll come washed"). */
  takesOff: boolean;
  minutes: string;
  available: boolean;
  /** A suggestion shops usually charge for: say so while the price is empty. */
  paidHint?: boolean;
};

export type GroupDraft = {
  key: string;
  id?: string;
  name: string;
  question: string;
  kind: 'ONE' | 'MANY';
  required: boolean;
  maxPicks: number | null;
  healthRelated: boolean;
  /** "Show only if" this answer of an earlier question is picked. */
  showIf: { groupKey: string; optionKey: string } | null;
  suggestionKey: string | null;
  options: OptionDraft[];
  open: boolean;
};

let made = 0;
const newKey = (what: string) => `${what}-${Date.now().toString(36)}-${(made += 1)}`;

const blankOption = (): OptionDraft => ({
  key: newKey('o'),
  label: '',
  description: '',
  price: '',
  takesOff: false,
  minutes: '',
  available: true,
});

// ---------- In and out of the form ----------

/** A saved service's questions, as the form edits them. */
export function groupsFromService(groups: ChoiceGroup[], money: Money): GroupDraft[] {
  const drafts: GroupDraft[] = groups.map((g) => ({
    key: g.id,
    id: g.id,
    name: g.name,
    question: g.question ?? '',
    kind: g.kind,
    required: g.required,
    maxPicks: g.maxPicks,
    healthRelated: g.healthRelated,
    showIf: null,
    suggestionKey: g.suggestionKey,
    open: false,
    options: g.options.map((o) => ({
      key: o.id,
      id: o.id,
      label: o.label,
      description: o.description ?? '',
      price: o.priceMinor ? money.toMajor(Math.abs(o.priceMinor)) : '',
      takesOff: o.priceMinor < 0,
      minutes: o.extraMinutes ? String(o.extraMinutes) : '',
      available: o.available,
    })),
  }));
  groups.forEach((g, index) => {
    if (!g.showIfOptionId) return;
    const parent = groups.find((p) => p.options.some((o) => o.id === g.showIfOptionId));
    if (parent) drafts[index].showIf = { groupKey: parent.id, optionKey: g.showIfOptionId };
  });
  return drafts;
}

/** A draft's questions (§123) — written in the shape the form sends, maybe half-finished. */
export function groupsFromDraft(choices: unknown, money: Money): GroupDraft[] {
  if (!Array.isArray(choices)) return [];
  type Loose = Partial<ChoiceGroupInput> & { options?: Array<Partial<ChoiceGroupInput['options'][number]>> };
  const list = choices as Loose[];
  const drafts: GroupDraft[] = list.map((g) => ({
    key: newKey('g'),
    name: g.name ?? '',
    question: g.question ?? '',
    kind: g.kind === 'MANY' ? 'MANY' : 'ONE',
    required: g.required === true,
    maxPicks: g.maxPicks ?? null,
    healthRelated: g.healthRelated === true,
    showIf: null,
    suggestionKey: g.suggestionKey ?? null,
    open: false,
    options: (g.options ?? []).map((o) => ({
      key: newKey('o'),
      label: o.label ?? '',
      description: o.description ?? '',
      price: o.priceMinor ? money.toMajor(Math.abs(o.priceMinor)) : '',
      takesOff: (o.priceMinor ?? 0) < 0,
      minutes: o.extraMinutes ? String(o.extraMinutes) : '',
      available: o.available !== false,
    })),
  }));
  list.forEach((g, index) => {
    const at = g.showIf;
    const parent = at ? drafts[at.group] : undefined;
    const option = at && parent ? parent.options[at.option] : undefined;
    if (parent && option && at!.group < index) drafts[index].showIf = { groupKey: parent.key, optionKey: option.key };
  });
  return drafts;
}

const minor = (o: OptionDraft, money: Money) => {
  const value = o.price.trim() ? money.toMinor(o.price) : 0;
  const amount = Number.isFinite(value) ? Math.abs(value) : 0;
  return o.takesOff ? -amount : amount;
};
const minutesOf = (o: OptionDraft) => {
  const value = Math.round(Number(o.minutes || 0));
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 480) : 0;
};

/** What the server takes (§300): "show only if" turned back into positions. */
export function groupsToInput(groups: GroupDraft[], money: Money): ChoiceGroupInput[] {
  return groups.map((g) => {
    const parentAt = g.showIf ? groups.findIndex((p) => p.key === g.showIf!.groupKey) : -1;
    const optionAt = parentAt >= 0 ? groups[parentAt].options.findIndex((o) => o.key === g.showIf!.optionKey) : -1;
    return {
      ...(g.id ? { id: g.id } : {}),
      name: g.name.trim(),
      question: g.question.trim() || null,
      kind: g.kind,
      required: g.required,
      maxPicks: g.kind === 'MANY' ? g.maxPicks : null,
      healthRelated: g.healthRelated,
      showIf: optionAt >= 0 ? { group: parentAt, option: optionAt } : null,
      suggestionKey: g.suggestionKey,
      options: g.options.map((o) => ({
        ...(o.id ? { id: o.id } : {}),
        label: o.label.trim(),
        description: o.description.trim() || null,
        priceMinor: g.healthRelated ? 0 : minor(o, money),
        extraMinutes: g.healthRelated ? 0 : minutesOf(o),
        available: o.available,
      })),
    };
  });
}

/** What would stop the questions being saved, in words — or null. */
export function choicesProblem(groups: GroupDraft[]): string | null {
  for (const [index, g] of groups.entries()) {
    const name = g.name.trim() || `Question ${index + 1}`;
    if (!g.name.trim()) return `Question ${index + 1} needs a name.`;
    if (g.options.length === 0) return `“${name}” needs at least one answer.`;
    const blank = g.options.findIndex((o) => !o.label.trim());
    if (blank >= 0) return `Answer ${blank + 1} of “${name}” needs a name.`;
    if (g.required && !g.options.some((o) => o.available)) {
      return `“${name}” must be answered, so at least one answer has to be available.`;
    }
  }
  return null;
}

/** A ready-made suggestion as a question in the form. */
function fromSuggestion(s: ChoiceSuggestion): GroupDraft {
  return {
    key: newKey('g'),
    name: s.name,
    question: s.question,
    kind: s.kind,
    required: s.required,
    maxPicks: s.maxPicks ?? null,
    healthRelated: s.healthRelated ?? false,
    showIf: null,
    suggestionKey: s.key,
    open: true,
    options: s.options.map((o) => ({
      key: newKey('o'),
      label: o.label,
      description: o.description ?? '',
      price: '',
      takesOff: false,
      minutes: o.extraMinutes ? String(o.extraMinutes) : '',
      available: true,
      paidHint: o.paid ?? false,
    })),
  };
}

/**
 * "Show only if" kept sound after any change (§300): it points at an answer
 * above, of a question that is not itself conditional, which still exists —
 * otherwise it is dropped and the question is asked every time. A question
 * shown only after a private answer is private too, or its answers would
 * give that one away.
 */
function normalise(groups: GroupDraft[]): GroupDraft[] {
  return groups.map((g, index) => {
    if (!g.showIf) return g;
    const at = groups.findIndex((p) => p.key === g.showIf!.groupKey);
    const parent = groups[at];
    const sound = parent && at < index && !parent.showIf && parent.options.some((o) => o.key === g.showIf!.optionKey);
    if (!sound) return { ...g, showIf: null };
    if (parent.healthRelated && !g.healthRelated) {
      return { ...g, healthRelated: true, options: g.options.map((o) => ({ ...o, price: '', takesOff: false, minutes: '' })) };
    }
    return g;
  });
}

// ---------- The section ----------

export function ChoicesEditor({
  money,
  groups,
  onGroups,
  noteEnabled,
  onNoteEnabled,
  notePrompt,
  onNotePrompt,
  priceAtShop,
  onPriceAtShop,
  basePriceMinor,
  durationMinutes,
}: {
  money: Money;
  groups: GroupDraft[];
  onGroups: (next: GroupDraft[] | ((was: GroupDraft[]) => GroupDraft[])) => void;
  noteEnabled: boolean;
  onNoteEnabled: (next: boolean) => void;
  notePrompt: string;
  onNotePrompt: (next: string) => void;
  priceAtShop: boolean;
  onPriceAtShop: (next: boolean) => void;
  /** The cheapest branch price typed, for the preview's total. */
  basePriceMinor: number | null;
  durationMinutes: number;
}) {
  const suggestions = useQuery({ queryKey: ['choice-suggestions'], queryFn: getChoiceSuggestions, staleTime: 10 * 60_000 });
  const sections = suggestions.data?.sections ?? [];
  const [sectionAt, setSectionAt] = useState(0);
  const section = sections[Math.min(sectionAt, Math.max(sections.length - 1, 0))];
  const added = new Set(groups.map((g) => g.suggestionKey).filter(Boolean));
  const full = groups.length >= MAX_GROUPS;

  /** Every change, kept sound: "show only if" pointing up one step, private under private. */
  const change = (fn: (was: GroupDraft[]) => GroupDraft[]) => onGroups((was) => normalise(fn(was)));
  const update = (key: string, edit: (g: GroupDraft) => GroupDraft) =>
    change((was) => was.map((g) => (g.key === key ? edit(g) : g)));

  const addSuggestion = (s: ChoiceSuggestion) => {
    const all = sections.flatMap((x) => x.suggestions);
    const parentSuggestion = s.showIf ? all.find((p) => p.key === s.showIf!.key) : undefined;
    change((was) => {
      const next = [...was.map((g) => ({ ...g, open: false }))];
      let parent = s.showIf ? next.find((g) => g.suggestionKey === s.showIf!.key) : undefined;
      if (s.showIf && !parent && parentSuggestion) {
        if (next.length + 2 > MAX_GROUPS) return was;
        parent = { ...fromSuggestion(parentSuggestion), open: false };
        next.push(parent);
      }
      if (next.length + 1 > MAX_GROUPS) return was;
      const group = fromSuggestion(s);
      const option = parent?.options.find((o) => o.label === s.showIf?.option);
      if (parent && option) group.showIf = { groupKey: parent.key, optionKey: option.key };
      next.push(group);
      return next;
    });
  };

  const addOwn = () =>
    change((was) =>
      was.length >= MAX_GROUPS
        ? was
        : [
            ...was.map((g) => ({ ...g, open: false })),
            {
              key: newKey('g'),
              name: '',
              question: '',
              kind: 'ONE',
              required: false,
              maxPicks: null,
              healthRelated: false,
              showIf: null,
              suggestionKey: null,
              open: true,
              options: [blankOption(), blankOption()],
            },
          ],
    );

  const remove = async (group: GroupDraft) => {
    if (group.id || group.name.trim() || group.options.some((o) => o.label.trim())) {
      const children = groups.filter((g) => g.showIf?.groupKey === group.key);
      const ok = await confirmDialog({
        title: `Remove “${group.name.trim() || 'this question'}”?`,
        body: (
          <p>
            Customers stop being asked it once you save. Bookings already made keep the answers they had.
            {children.length > 0 && (
              <>
                {' '}
                {children.map((c) => `“${c.name}”`).join(' and ')} {children.length === 1 ? 'depends' : 'depend'} on it, so{' '}
                {children.length === 1 ? 'it will be' : 'they will be'} asked every time.
              </>
            )}
          </p>
        ),
        tone: 'danger',
        icon: 'trash',
        confirmLabel: 'Remove question',
        cancelLabel: 'Keep it',
      });
      if (!ok) return;
    }
    change((was) =>
      was
        .filter((g) => g.key !== group.key)
        .map((g) => (g.showIf?.groupKey === group.key ? { ...g, showIf: null } : g)),
    );
  };

  const move = (key: string, by: -1 | 1) =>
    change((was) => {
      const from = was.findIndex((g) => g.key === key);
      const to = from + by;
      if (from < 0 || to < 0 || to >= was.length) return was;
      const next = [...was];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  /** A question can move only where its "show only if" still points above it. */
  const canMove = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= groups.length) return false;
    const me = groups[index];
    const other = groups[to];
    if (by === -1 && me.showIf?.groupKey === other.key) return false;
    if (by === 1 && other.showIf?.groupKey === me.key) return false;
    return true;
  };

  return (
    <div className="ch">
      {groups.length === 0 && (
        <div className="ch-empty">
          <div className="ch-empty-art" aria-hidden="true">
            <span style={{ animationDelay: '0ms' }}>Long hair · +30 min</span>
            <span style={{ animationDelay: '140ms' }}>SUV · +{money.code} 3,000</span>
            <span style={{ animationDelay: '280ms' }}>No salt</span>
          </div>
          <p>
            Let customers tailor the booking: hair length, car size, “no salt”. An answer can add to the price and the
            time, and you see every answer on the booking.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <ol className="ch-list">
          {groups.map((group, index) => (
            <GroupCard
              key={group.key}
              group={group}
              index={index}
              groups={groups}
              money={money}
              canUp={canMove(index, -1)}
              canDown={canMove(index, 1)}
              onChange={(change) => update(group.key, change)}
              onMove={(by) => move(group.key, by)}
              onRemove={() => void remove(group)}
            />
          ))}
        </ol>
      )}

      <button type="button" className="ch-add" onClick={addOwn} disabled={full}>
        <Icon name="plus" size={17} stroke={2.4} />
        {full ? `Up to ${MAX_GROUPS} questions per service` : 'Write your own question'}
      </button>

      {section && (
        <div className="ch-suggest">
          <div className="ch-suggest-head">
            <span className="ch-suggest-icon">
              <Icon name="sparkles" size={16} />
            </span>
            <div>
              <strong>Ready-made for {section.subcategory === 'Other' ? section.category : section.subcategory}</strong>
              <span>Add one, then change the words and set your prices.</span>
            </div>
          </div>
          {sections.length > 1 && (
            <div className="ch-suggest-tabs" role="tablist">
              {sections.map((s, i) => (
                <button
                  key={`${s.category}/${s.subcategory}`}
                  type="button"
                  role="tab"
                  aria-selected={s === section}
                  className={s === section ? 'is-on' : ''}
                  onClick={() => setSectionAt(i)}
                >
                  {s.subcategory === 'Other' ? s.category : s.subcategory}
                </button>
              ))}
            </div>
          )}
          <div className="ch-suggest-list">
            {section.suggestions.map((s, i) => {
              const isAdded = added.has(s.key);
              const needsParent = s.showIf && !added.has(s.showIf.key);
              const blocked = !isAdded && groups.length + (needsParent ? 2 : 1) > MAX_GROUPS;
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`ch-sug${isAdded ? ' is-added' : ''}`}
                  style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                  disabled={isAdded || blocked}
                  title={s.hint ?? (blocked ? `Up to ${MAX_GROUPS} questions per service` : undefined)}
                  onClick={() => addSuggestion(s)}
                >
                  <span className="ch-sug-top">
                    <strong>{s.name}</strong>
                    {s.healthRelated && (
                      <span className="ch-sug-private">
                        <Icon name="lock" size={11} stroke={2.4} /> Private
                      </span>
                    )}
                  </span>
                  <span className="ch-sug-q">{s.question}</span>
                  <span className="ch-sug-foot">
                    <span>
                      {s.kind === 'MANY' ? 'Pick several' : 'Pick one'}
                      {s.required ? ' · required' : ''} · {s.options.length} answers
                    </span>
                    <i>{isAdded ? <Icon name="check" size={14} stroke={2.8} /> : <Icon name="plus" size={14} stroke={2.6} />}</i>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="ch-settings">
        <div className="ch-setting">
          <div>
            <strong>A note from the customer</strong>
            <span>
              Up to 250 letters, shown to you on the booking. Requests are a “we’ll try”; allergies go in the questions,
              never in the note.
            </span>
          </div>
          <Switch checked={noteEnabled} onChange={onNoteEnabled} label="Let customers write a note" />
        </div>
        {noteEnabled && (
          <div className="sv-field ch-prompt">
            <label htmlFor="snoteprompt">
              Words above the box <em>{notePrompt.length}/120</em>
            </label>
            <input
              id="snoteprompt"
              maxLength={120}
              value={notePrompt}
              onChange={(e) => onNotePrompt(e.target.value)}
              placeholder={suggestions.data?.notePrompt ?? 'Anything the shop should know?'}
            />
            <span className="sv-help">Leave it empty to use the words written for shops like yours.</span>
          </div>
        )}
        <div className="ch-setting">
          <div>
            <strong>
              Price confirmed at the shop
              {suggestions.data?.priceAtShop && <em className="ch-usual">Usual for shops like yours</em>}
            </strong>
            <span>
              For work you can only price after seeing it — a repair, an event. Customers see “from” before the price,
              and the deposit is on the price you set.
            </span>
          </div>
          <Switch checked={priceAtShop} onChange={onPriceAtShop} label="The price is confirmed at the shop" />
        </div>
      </div>

      {groups.some((g) => g.name.trim() && g.options.some((o) => o.label.trim())) && (
        <ChoicesPreview
          groups={groups}
          money={money}
          basePriceMinor={basePriceMinor}
          durationMinutes={durationMinutes}
          priceAtShop={priceAtShop}
        />
      )}
    </div>
  );
}

// ---------- One question ----------

function GroupCard({
  group,
  index,
  groups,
  money,
  canUp,
  canDown,
  onChange,
  onMove,
  onRemove,
}: {
  group: GroupDraft;
  index: number;
  groups: GroupDraft[];
  money: Money;
  canUp: boolean;
  canDown: boolean;
  onChange: (change: (g: GroupDraft) => GroupDraft) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const set = (fields: Partial<GroupDraft>) => onChange((g) => ({ ...g, ...fields }));
  const setOption = (key: string, fields: Partial<OptionDraft>) =>
    onChange((g) => ({ ...g, options: g.options.map((o) => (o.key === key ? { ...o, ...fields } : o)) }));

  const parent = group.showIf ? groups.find((g) => g.key === group.showIf!.groupKey) : undefined;
  const parentOption = parent?.options.find((o) => o.key === group.showIf!.optionKey);
  const children = groups.filter((g) => g.showIf?.groupKey === group.key);

  // "Show only if" may point at an answer above, of a question that is not
  // itself conditional — and, unless this one is private, not a private one,
  // which would give its answer away (§300.6).
  const conditions = groups.slice(0, index).flatMap((g) =>
    g.showIf || (g.healthRelated && !group.healthRelated)
      ? []
      : g.options
          .filter((o) => o.label.trim())
          .map((o) => ({ value: `${g.key}|${o.key}`, label: `When “${o.label.trim()}” is picked`, group: g.name.trim() || 'Untitled question' })),
  );

  const prices = group.options.map((o) => minor(o, money));
  const most = Math.max(0, ...prices);
  const longest = Math.max(0, ...group.options.map(minutesOf));
  const summary = [
    group.kind === 'MANY' ? (group.maxPicks ? `Pick up to ${group.maxPicks}` : 'Pick several') : 'Pick one',
    group.required ? 'required' : 'optional',
    `${group.options.length} ${group.options.length === 1 ? 'answer' : 'answers'}`,
    !group.healthRelated && most > 0 && `up to +${money.format(most)}`,
    !group.healthRelated && longest > 0 && `+${longest} min`,
  ].filter(Boolean);

  const makePrivate = (on: boolean) =>
    onChange((g) => ({
      ...g,
      healthRelated: on,
      // A private question's answers never move money or time (§300.6).
      options: on ? g.options.map((o) => ({ ...o, price: '', takesOff: false, minutes: '' })) : g.options,
    }));

  return (
    <li className={`ch-group${group.open ? ' is-open' : ''}${group.healthRelated ? ' is-private' : ''}`}>
      <div className="ch-group-head">
        <button type="button" className="ch-group-toggle" onClick={() => set({ open: !group.open })} aria-expanded={group.open}>
          <span className="ch-num">{index + 1}</span>
          <span className="ch-group-title">
            <strong>{group.name.trim() || 'New question'}</strong>
            <span>{summary.join(' · ')}</span>
          </span>
        </button>
        <span className="ch-badges">
          {group.healthRelated && (
            <span className="ch-badge is-private">
              <Icon name="lock" size={12} stroke={2.4} /> Private
            </span>
          )}
          {parentOption && (
            <span className="ch-badge is-if" title={`Asked only when “${parentOption.label}” is picked`}>
              <Icon name="eye" size={12} /> Only if “{parentOption.label}”
            </span>
          )}
        </span>
        <span className="ch-tools">
          <button type="button" onClick={() => onMove(-1)} disabled={!canUp} aria-label="Move up">
            <Icon name="chevronUp" size={16} />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={!canDown} aria-label="Move down">
            <Icon name="chevronDown" size={16} />
          </button>
          <button type="button" className="is-danger" onClick={onRemove} aria-label="Remove question">
            <Icon name="trash" size={15} />
          </button>
        </span>
      </div>

      <div className="ch-group-fold">
        <div className="ch-group-body">
          <div className="sv-two">
            <div className="sv-field">
              <label htmlFor={`${group.key}-name`}>
                Name <em>for you</em>
              </label>
              <input
                id={`${group.key}-name`}
                maxLength={60}
                value={group.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Hair length"
              />
            </div>
            <div className="sv-field">
              <label htmlFor={`${group.key}-q`}>
                Question <em>customers see</em>
              </label>
              <input
                id={`${group.key}-q`}
                maxLength={120}
                value={group.question}
                onChange={(e) => set({ question: e.target.value })}
                placeholder={group.name.trim() ? `${group.name.trim()}?` : 'e.g. How long is your hair?'}
              />
            </div>
          </div>

          <div className="ch-rules">
            <div className="ch-seg" role="radiogroup" aria-label="How many answers">
              {(['ONE', 'MANY'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={group.kind === kind}
                  className={group.kind === kind ? 'is-on' : ''}
                  onClick={() => set({ kind, maxPicks: kind === 'ONE' ? null : group.maxPicks })}
                >
                  <Icon name={kind === 'ONE' ? 'dot' : 'layers'} size={14} />
                  {kind === 'ONE' ? 'Pick one' : 'Pick several'}
                </button>
              ))}
            </div>
            {group.kind === 'MANY' && group.options.length > 1 && (
              <div className="ch-max">
                <Select
                  value={String(group.maxPicks ?? 0)}
                  onChange={(v) => set({ maxPicks: Number(v) || null })}
                  label="The most a customer may pick"
                  options={[
                    { value: '0', label: 'As many as they like' },
                    ...Array.from({ length: group.options.length - 1 }, (_, i) => ({
                      value: String(i + 1),
                      label: `Up to ${i + 1}`,
                    })),
                  ]}
                />
              </div>
            )}
            <label className="ch-check">
              <Switch checked={group.required} onChange={(required) => set({ required })} label="Must be answered" />
              <span>Must be answered</span>
            </label>
            <label className="ch-check" title="Allergies, diet, health, anything personal">
              <Switch
                checked={group.healthRelated}
                onChange={makePrivate}
                label="Private: health or personal"
                disabled={Boolean(parent?.healthRelated)}
              />
              <span>
                Private <i>health or personal</i>
              </span>
            </label>
          </div>

          {group.healthRelated && (
            <p className="ch-private-note">
              <Icon name="lock" size={15} />
              <span>
                Sealed: only you and the customer see these answers — never in an email or a phone alert — and they are
                removed 30 days after the visit. Private answers are always free and take no extra time.
              </span>
            </p>
          )}

          {(conditions.length > 0 || group.showIf) && (
            <div className="sv-field">
              <label>Ask it</label>
              <Select
                value={group.showIf ? `${group.showIf.groupKey}|${group.showIf.optionKey}` : 'always'}
                onChange={(v) => {
                  if (v === 'always') return set({ showIf: null });
                  const [groupKey, optionKey] = v.split('|');
                  set({ showIf: { groupKey, optionKey } });
                }}
                label="When to ask this question"
                options={[{ value: 'always', label: 'Every time' }, ...conditions]}
              />
              {children.length > 0 && (
                <span className="sv-help">
                  {children.map((c) => `“${c.name}”`).join(' and ')} {children.length === 1 ? 'is' : 'are'} asked only
                  after an answer here.
                </span>
              )}
            </div>
          )}

          <div className={`ch-options${group.healthRelated ? ' is-free' : ''}`}>
            <div className="ch-options-head" aria-hidden="true">
              <span>Answer</span>
              {!group.healthRelated && (
                <>
                  <span>Price</span>
                  <span>Extra time</span>
                </>
              )}
              <span>Available</span>
            </div>
            {group.options.map((option, at) => (
              <OptionRow
                key={option.key}
                option={option}
                index={at}
                money={money}
                free={group.healthRelated}
                canRemove={group.options.length > 1}
                onChange={(fields) => setOption(option.key, fields)}
                onRemove={() =>
                  onChange((g) => ({ ...g, options: g.options.filter((o) => o.key !== option.key) }))
                }
              />
            ))}
          </div>
          <button
            type="button"
            className="link ch-add-option"
            disabled={group.options.length >= MAX_OPTIONS}
            onClick={() => onChange((g) => ({ ...g, options: [...g.options, blankOption()] }))}
          >
            <Icon name="plus" size={15} stroke={2.4} />
            {group.options.length >= MAX_OPTIONS ? `Up to ${MAX_OPTIONS} answers` : 'Add an answer'}
          </button>
        </div>
      </div>
    </li>
  );
}

function OptionRow({
  option,
  index,
  money,
  free,
  canRemove,
  onChange,
  onRemove,
}: {
  option: OptionDraft;
  index: number;
  money: Money;
  /** A private question's answers: no price, no time (§300.6). */
  free: boolean;
  canRemove: boolean;
  onChange: (fields: Partial<OptionDraft>) => void;
  onRemove: () => void;
}) {
  const [describing, setDescribing] = useState(Boolean(option.description));
  const askPrice = option.paidHint && !option.price.trim();
  return (
    <div className={`ch-option${option.available ? '' : ' is-off'}`}>
      <div className="ch-option-label">
        <input
          aria-label={`Answer ${index + 1}`}
          maxLength={60}
          value={option.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={index === 0 ? 'e.g. Short' : index === 1 ? 'e.g. Long' : 'Another answer'}
        />
        {describing ? (
          <input
            className="ch-option-desc"
            aria-label={`A line about answer ${index + 1}`}
            maxLength={140}
            value={option.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="A line about it — e.g. Below the shoulders"
            autoFocus={!option.description}
          />
        ) : (
          <button type="button" className="link ch-describe" onClick={() => setDescribing(true)}>
            + a line about it
          </button>
        )}
      </div>
      {!free && (
        <>
          <div className={`ch-price${askPrice ? ' is-ask' : ''}`}>
            <button
              type="button"
              className={`ch-sign${option.takesOff ? ' is-off' : ''}`}
              onClick={() => onChange({ takesOff: !option.takesOff })}
              aria-label={option.takesOff ? 'Takes money off — make it add' : 'Adds money — make it take off'}
              title={option.takesOff ? 'Takes money off' : 'Adds to the price'}
            >
              {option.takesOff ? '−' : '+'}
            </button>
            <span className="sv-affix">
              <span>{money.code}</span>
              <input
                type="number"
                min="0"
                step={money.exponent === 0 ? '1' : '0.01'}
                inputMode="decimal"
                aria-label={`Price for answer ${index + 1}`}
                value={option.price}
                onChange={(e) => onChange({ price: e.target.value.replace('-', '') })}
                placeholder="0"
              />
            </span>
            {askPrice && <em>Usually costs more</em>}
          </div>
          <div className="ch-minutes">
            <span className="sv-affix">
              <input
                type="number"
                min="0"
                max="480"
                step="5"
                inputMode="numeric"
                aria-label={`Extra minutes for answer ${index + 1}`}
                value={option.minutes}
                onChange={(e) => onChange({ minutes: e.target.value })}
                placeholder="0"
              />
              <span>min</span>
            </span>
          </div>
        </>
      )}
      <div className="ch-option-end">
        <Switch
          checked={option.available}
          onChange={(available) => onChange({ available })}
          label={option.available ? 'Available — switch off for “not available now”' : 'Not available now — switch on to offer it'}
        />
        <button type="button" className="ch-option-remove" onClick={onRemove} disabled={!canRemove} aria-label="Remove answer">
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------- What the customer sees ----------

/**
 * The questions as a customer meets them (§300), to try: tap answers and see
 * the total and the time change, exactly as the booking works it out — the
 * price for one, plus each answer once.
 */
function ChoicesPreview({
  groups,
  money,
  basePriceMinor,
  durationMinutes,
  priceAtShop,
}: {
  groups: GroupDraft[];
  money: Money;
  basePriceMinor: number | null;
  durationMinutes: number;
  priceAtShop: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ready = groups.filter((g) => g.name.trim() && g.options.some((o) => o.label.trim()));
  const visible = ready.filter((g) => !g.showIf || picked.has(g.showIf.optionKey));

  const toggle = (group: GroupDraft, option: OptionDraft) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(option.key)) next.delete(option.key);
      else {
        if (group.kind === 'ONE') group.options.forEach((o) => next.delete(o.key));
        const mine = group.options.filter((o) => next.has(o.key)).length;
        if (group.kind === 'MANY' && group.maxPicks && mine >= group.maxPicks) return was;
        next.add(option.key);
      }
      // Answers to questions no longer shown fall away.
      for (const g of ready) {
        if (g.showIf && !next.has(g.showIf.optionKey)) g.options.forEach((o) => next.delete(o.key));
      }
      return next;
    });

  const { extra, minutes } = useMemo(() => {
    let extra = 0;
    let minutes = 0;
    for (const g of visible) {
      if (g.healthRelated) continue;
      for (const o of g.options) {
        if (!picked.has(o.key)) continue;
        extra += minor(o, money);
        minutes += minutesOf(o);
      }
    }
    return { extra, minutes };
  }, [visible, picked, money]);

  const missing = visible.filter((g) => g.required && !g.options.some((o) => picked.has(o.key))).length;

  return (
    <div className="ch-preview">
      <div className="ch-preview-head">
        <Icon name="eye" size={16} />
        <strong>How customers see it</strong>
        <span>Tap answers to try it</span>
      </div>
      <div className="ch-phone">
        {visible.map((g) => {
          const answered = g.options.filter((o) => picked.has(o.key)).length;
          return (
            <div key={g.key} className="ch-q">
              <div className="ch-q-head">
                <strong>{g.question.trim() || `${g.name.trim()}?`}</strong>
                <span className={g.required && answered === 0 ? 'is-need' : ''}>
                  {g.kind === 'MANY' ? (g.maxPicks ? `Choose up to ${g.maxPicks}` : 'Choose any') : 'Pick 1'}
                  {g.required ? ' · Required' : ''}
                </span>
              </div>
              {g.healthRelated && (
                <p className="ch-q-private">
                  <Icon name="lock" size={12} /> Only the shop sees this.
                </p>
              )}
              <div className="ch-q-options">
                {g.options
                  .filter((o) => o.label.trim())
                  .map((o) => {
                    const price = g.healthRelated ? 0 : minor(o, money);
                    const mins = g.healthRelated ? 0 : minutesOf(o);
                    const on = picked.has(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        className={`ch-pill${on ? ' is-on' : ''}${g.kind === 'MANY' ? ' is-many' : ''}`}
                        disabled={!o.available}
                        onClick={() => toggle(g, o)}
                      >
                        <i aria-hidden="true">{on && <Icon name="check" size={11} stroke={3} />}</i>
                        <span>{o.label.trim()}</span>
                        {!o.available ? (
                          <em>Not available</em>
                        ) : (
                          (price !== 0 || mins > 0) && (
                            <em>
                              {price !== 0 && `${price > 0 ? '+' : '−'}${money.format(Math.abs(price))}`}
                              {price !== 0 && mins > 0 && ' · '}
                              {mins > 0 && `+${mins} min`}
                            </em>
                          )
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
        })}
        <div className="ch-total">
          <div>
            <span>{priceAtShop ? 'From' : 'Total'}</span>
            <strong>
              {basePriceMinor === null
                ? `${extra >= 0 ? '+' : '−'}${money.format(Math.abs(extra))}`
                : money.format(Math.max(0, basePriceMinor + extra))}
            </strong>
          </div>
          <div>
            <span>Takes</span>
            <strong>{durationMinutes + minutes} min</strong>
          </div>
          <span className={`ch-total-state${missing ? ' is-need' : ''}`}>
            {missing ? `${missing} to answer` : 'Ready to choose a time'}
          </span>
        </div>
      </div>
      {basePriceMinor === null && <p className="sv-help">Give a price at a branch to see the full total.</p>}
    </div>
  );
}
