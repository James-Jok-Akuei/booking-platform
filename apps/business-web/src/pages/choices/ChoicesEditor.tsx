import { useMemo, useState, type ReactNode } from 'react';
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
import { MoreMenu } from '../../ui/MoreMenu';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import './choices.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { plural } from '@lingui/core/macro';
import { listOf } from '../../i18n/format';

/**
 * Questions for customers (§300, §304): what a customer answers while
 * booking this service — the cut, the size of the car, "no salt" — and what
 * each answer adds to the price and the time.
 *
 * Built for a seller who meets it alone, with nobody to explain it (§304):
 * a ready-made question is one tap to add and one to take back; each question
 * is three plain steps — what you ask, how many answers, the answers — with
 * every box labelled where it sits; the rarer settings wait under "More
 * options"; and a preview shows it as the customer will.
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
  /** Just added and not changed since: taking it back asks nothing. */
  fresh?: boolean;
};

/** What the customer is asked — or, before the words are written, its short name. */
export const titleOf = (g: Pick<GroupDraft, 'name' | 'question'>) => g.question.trim() || g.name.trim();

/** A short name for the shop's bookings, from the question when none was written: "Which cut?" → "Which cut". */
const shortName = (g: Pick<GroupDraft, 'name' | 'question'>) =>
  g.name.trim() || g.question.trim().replace(/[?？]+$/, '').trim().slice(0, 60);

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

/** "“Colour?” is asked only after an answer here." — the names joined the language's way. */
function askedAfter(titles: string[]) {
  const names = listOf(titles.map((title) => `“${title}”`));
  return plural(titles.length, {
    one: `${names} is asked only after an answer here.`,
    other: `${names} are asked only after an answer here.`,
  });
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
      name: shortName(g),
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
    const title = titleOf(g);
    const number = index + 1;
    if (!title) return t`Question ${number}: write what you ask customers.`;
    if (g.options.length === 0) return t`“${title}”: add at least one answer.`;
    const blank = g.options.findIndex((o) => !o.label.trim());
    const answer = blank + 1;
    if (blank >= 0) return t`“${title}”: answer ${answer} is empty — write it, or remove it.`;
    if (g.required && !g.options.some((o) => o.available)) {
      return t`“${title}”: customers must answer it, so at least one answer has to be offered.`;
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
    fresh: true,
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
  const full = groups.length >= MAX_GROUPS;

  /** Every change, kept sound: "show only if" pointing up one step, private under private. */
  const change = (fn: (was: GroupDraft[]) => GroupDraft[]) => onGroups((was) => normalise(fn(was)));
  const update = (key: string, edit: (g: GroupDraft) => GroupDraft) =>
    change((was) => was.map((g) => (g.key === key ? edit(g) : g)));

  /** Open one question, close the rest, and bring it into view. */
  const openOnly = (key: string) => {
    change((was) => was.map((g) => ({ ...g, open: g.key === key })));
    requestAnimationFrame(() =>
      document.getElementById(`ch-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
  };

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

  const addOwn = () => {
    const key = newKey('g');
    change((was) =>
      was.length >= MAX_GROUPS
        ? was
        : [
            ...was.map((g) => ({ ...g, open: false })),
            {
              key,
              name: '',
              question: '',
              kind: 'ONE',
              required: false,
              maxPicks: null,
              healthRelated: false,
              showIf: null,
              suggestionKey: null,
              open: true,
              fresh: true,
              options: [blankOption(), blankOption()],
            },
          ],
    );
    requestAnimationFrame(() => document.getElementById(`${key}-q`)?.focus());
  };

  const remove = async (group: GroupDraft) => {
    const touched = group.id || (!group.fresh && (titleOf(group) || group.options.some((o) => o.label.trim())));
    const children = groups.filter((g) => g.showIf?.groupKey === group.key);
    // The questions asked only after this one, named: “Length” and “Colour”.
    const followUps = listOf(children.map((c) => `“${titleOf(c)}”`));
    if (touched || children.length > 0) {
      const ok = await confirmDialog({
        title: titleOf(group) ? t`Remove “${titleOf(group)}”?` : t`Remove this question?`,
        body: (
          <p>
            <Trans>Customers stop being asked it once you save. Bookings already made keep the answers they had.</Trans>
          {children.length > 0 && (
              <>
                {' '}
                {children.length === 1
                  ? t`${followUps} was asked only after an answer here, so it will be asked every time.`
                  : t`${followUps} were asked only after an answer here, so they will be asked every time.`}
              </>
            )}
          </p>
        ),
        tone: 'danger',
        icon: 'trash',
        confirmLabel: t`Remove question`,
        cancelLabel: t`Keep it`,
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

  const ready = groups.some((g) => titleOf(g) && g.options.some((o) => o.label.trim()));
  const kindName = section ? (section.subcategory === 'Other' ? section.category : section.subcategory) : null;

  return (
    <div className="ch">
      {groups.length === 0 && <HowItWorks money={money} example={section?.suggestions[0]} />}

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
              onChange={(edit) => update(group.key, edit)}
              onOpen={() => (group.open ? update(group.key, (g) => ({ ...g, open: false })) : openOnly(group.key))}
              onMove={(by) => move(group.key, by)}
              onRemove={() => void remove(group)}
            />
          ))}
        </ol>
      )}

      <div className="ch-start">
        <h4 className="ch-start-title">{groups.length ? t`Add another question` : t`Add your first question`}</h4>

        {section && (
          <div className="ch-ready">
            <div className="ch-ready-head">
              <span className="ch-ready-icon">
                <Icon name="sparkles" size={16} />
              </span>
              <div>
                <strong><Trans>Ready-made for {kindName}</Trans></strong>
                <span><Trans>Add one in a tap, then set your prices. You can change any of the words.</Trans></span>
              </div>
            </div>
            {sections.length > 1 && (
              <div className="ch-ready-tabs" role="tablist" aria-label={t`Kinds of shop`}>
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
            <div className="ch-ready-list">
              {section.suggestions.map((s, i) => {
                const group = groups.find((g) => g.suggestionKey === s.key);
                const needsParent = s.showIf && !groups.some((g) => g.suggestionKey === s.showIf!.key);
                const blocked = !group && groups.length + (needsParent ? 2 : 1) > MAX_GROUPS;
                const parentName = s.showIf
                  ? sections.flatMap((x) => x.suggestions).find((p) => p.key === s.showIf!.key)?.name
                  : undefined;
                return (
                  <article
                    key={s.key}
                    className={`ch-card${group ? ' is-added' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                  >
                    <div className="ch-card-top">
                      <strong>{s.question}</strong>
                      {group && (
                        <span className="ch-card-added">
                          <Icon name="check" size={12} stroke={3} />{' '}
                          <Trans>Added</Trans>
                        </span>
                      )}
                    </div>
                    <ul className="ch-card-answers" aria-label={t`Its answers`}>
                      {s.options.slice(0, 4).map((o) => (
                        <li key={o.label}>{o.label}</li>
                      ))}
                      {s.options.length > 4 && <li className="is-more">+{s.options.length - 4}<Trans>more</Trans></li>}
                    </ul>
                    <p className="ch-card-meta">
                      {s.kind === 'MANY' ? t`They can pick several` : t`They pick one`}
                      {s.required ? t` · must answer` : ''}
                      {s.healthRelated && (
                        <span className="ch-card-private">
                          <Icon name="lock" size={11} stroke={2.4} />{' '}
                          <Trans>Private</Trans>
                        </span>
                      )}
                    </p>
                    {needsParent && !group && parentName && (
                      <p className="ch-card-note"><Trans>Adds “{parentName}” too — it is asked after an answer there.</Trans></p>
                    )}
                    <div className="ch-card-actions">
                      {group ? (
                        <>
                          <button type="button" className="ch-card-btn" onClick={() => openOnly(group.key)}>
                            <Icon name="pencil" size={14} />{' '}
                            <Trans>Edit</Trans>
                          </button>
                          <button type="button" className="ch-card-btn is-remove" onClick={() => void remove(group)}>
                            <Icon name="close" size={14} />{' '}
                            <Trans>Remove</Trans>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="ch-card-btn is-add"
                          onClick={() => addSuggestion(s)}
                          disabled={blocked}
                          title={blocked ? t`Up to ${MAX_GROUPS} questions per service` : s.hint}
                        >
                          <Icon name="plus" size={14} stroke={2.6} />
                          <Trans>Add</Trans>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <button type="button" className="ch-add" onClick={addOwn} disabled={full}>
          <Icon name="pencil" size={16} />
          {full ? t`That’s the most — ${MAX_GROUPS} questions per service` : t`Write my own question`}
        </button>
      </div>

      {ready && (
        <ChoicesPreview
          groups={groups}
          money={money}
          basePriceMinor={basePriceMinor}
          durationMinutes={durationMinutes}
          priceAtShop={priceAtShop}
        />
      )}

      <div className="ch-settings">
        <h4 className="ch-start-title"><Trans>Also for this service</Trans></h4>
        <div className="ch-setting">
          <div>
            <strong><Trans>Customers can write a note</Trans></strong>
            <span>
              <Trans>
                A short message to you when they book (up to 250 letters), like “I’m left-handed”. You see it on the
                booking. Allergies and health go in a private question, never in the note.
              </Trans>
            </span>
          </div>
          <Switch checked={noteEnabled} onChange={onNoteEnabled} label={t`Let customers write a note`} />
        </div>
        {noteEnabled && (
          <div className="sv-field ch-prompt">
            <label htmlFor="snoteprompt"><Trans>Words above their note box <em>{notePrompt.length}/120</em></Trans>
            </label>
            <input
              id="snoteprompt"
              maxLength={120}
              value={notePrompt}
              onChange={(e) => onNotePrompt(e.target.value)}
              placeholder={suggestions.data?.notePrompt ?? t`Anything the shop should know?`}
            />
            <span className="sv-help"><Trans>Leave it empty to use the words shown here.</Trans></span>
          </div>
        )}
        <div className="ch-setting">
          <div>
            <strong>
              <Trans>The final price is agreed at the shop</Trans>
            {suggestions.data?.priceAtShop && <em className="ch-usual"><Trans>Common for shops like yours</Trans></em>}
            </strong>
            <span>
              <Trans>
                For work you can only price after seeing it, like a repair. Customers see “from” before your price, and
                the deposit is taken on that price.
              </Trans>
            </span>
          </div>
          <Switch checked={priceAtShop} onChange={onPriceAtShop} label={t`The final price is agreed at the shop`} />
        </div>
      </div>
    </div>
  );
}

/**
 * Before the first question: what this is, in three lines, beside an example
 * of what a customer sees — drawn as a picture, never as buttons to press.
 */
function HowItWorks({ money, example }: { money: Money; example?: ChoiceSuggestion }) {
  const extra = money.format(money.toMinor('2000'));
  const lines = example
    ? example.options.slice(0, 3).map((o, i) => ({
        label: o.label,
        adds: o.extraMinutes ? t`+${o.extraMinutes} min` : i === 1 ? `+${extra}` : null,
      }))
    : [
        { label: t`Short`, adds: null },
        { label: t`Medium`, adds: t`+15 min` },
        { label: t`Long`, adds: `+${extra} · ${t`+30 min`}` },
      ];
  return (
    <div className="ch-how">
      <div className="ch-how-text">
        <strong><Trans>Let customers say what they want</Trans></strong>
        <p><Trans>You ask a question; when customers book, they tap an answer. An answer can cost more or take longer — you decide.</Trans></p>
        <ol>
          <li><Trans>Add a question — a ready-made one below, or your own</Trans></li>
          <li><Trans>Set what each answer adds to the price or the time</Trans></li>
          <li><Trans>Save the service — customers see it when they book</Trans></li>
        </ol>
      </div>
      <figure className="ch-how-example" aria-label={t`An example of what customers see`}>
        <figcaption>
          <Icon name="eye" size={12} />{' '}
          <Trans>Example — what customers see</Trans>
        </figcaption>
        <div className="ch-ex-q">
          <strong>{example?.question ?? t`How long is your hair?`}</strong>
          <span>{example?.kind === 'MANY' ? t`Choose any` : t`Pick 1`}</span>
        </div>
        <ul>
          {lines.map((line, i) => (
            <li key={line.label} style={{ animationDelay: `${120 + i * 110}ms` }}>
              <i className={example?.kind === 'MANY' ? 'is-many' : ''} aria-hidden="true" />
              <span>{line.label}</span>
              {line.adds && <em>{line.adds}</em>}
            </li>
          ))}
        </ul>
      </figure>
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
  onOpen,
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
  onOpen: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  // Any change but opening it makes it the seller's own: taking it back then asks first.
  const set = (fields: Partial<GroupDraft>) => onChange((g) => ({ ...g, ...fields, fresh: false }));
  const setOption = (key: string, fields: Partial<OptionDraft>) =>
    onChange((g) => ({ ...g, fresh: false, options: g.options.map((o) => (o.key === key ? { ...o, ...fields } : o)) }));

  const parent = group.showIf ? groups.find((g) => g.key === group.showIf!.groupKey) : undefined;
  const parentOption = parent?.options.find((o) => o.key === group.showIf!.optionKey);
  const children = groups.filter((g) => g.showIf?.groupKey === group.key);

  // "Only after an answer" may point at an answer above, of a question that is
  // not itself conditional — and, unless this one is private, not a private
  // one, which would give its answer away (§300.6).
  const conditions = groups.slice(0, index).flatMap((g) =>
    g.showIf || (g.healthRelated && !group.healthRelated)
      ? []
      : g.options
          .filter((o) => o.label.trim())
          .map((o) => ({
            value: `${g.key}|${o.key}`,
            label: t`Only when they pick “${o.label.trim()}”`,
            group: titleOf(g) || t`Untitled question`,
          })),
  );

  const prices = group.options.map((o) => minor(o, money));
  const most = Math.max(0, ...prices);
  const longest = Math.max(0, ...group.options.map(minutesOf));
  // The example under the short name, as one sentence for translators (§308).
  const exampleName = shortName(group) || t`Cut`;
  const exampleAnswer = group.options.find((o) => o.label.trim())?.label.trim() || t`Skin fade`;
  const picks = group.maxPicks;
  const mostPrice = money.format(most);
  const summary = [
    group.kind === 'MANY' ? (picks ? t`They pick up to ${picks}` : t`They pick one or more`) : t`They pick one`,
    group.required ? t`must answer` : t`can skip`,
    plural(group.options.length, { one: '# answer', other: '# answers' }),
    !group.healthRelated && most > 0 && t`up to +${mostPrice}`,
    !group.healthRelated && longest > 0 && t`up to +${longest} min`,
  ].filter(Boolean);

  const makePrivate = (on: boolean) =>
    onChange((g) => ({
      ...g,
      fresh: false,
      healthRelated: on,
      // A private question's answers never move money or time (§300.6).
      options: on ? g.options.map((o) => ({ ...o, price: '', takesOff: false, minutes: '' })) : g.options,
    }));

  // More options starts open when something in it changes how the question is
  // asked, so nothing that matters is ever folded away unseen.
  const moreSet = [group.showIf, group.healthRelated].filter(Boolean).length;
  const [more, setMore] = useState(moreSet > 0);
  const title = titleOf(group);

  return (
    <li id={`ch-${group.key}`} className={`ch-group${group.open ? ' is-open' : ''}${group.healthRelated ? ' is-private' : ''}`}>
      <div className="ch-group-head">
        <button type="button" className="ch-group-toggle" onClick={onOpen} aria-expanded={group.open}>
          <span className="ch-num">{index + 1}</span>
          <span className="ch-group-title">
            <strong>{title || t`New question`}</strong>
            <span>{summary.join(' · ')}</span>
          </span>
          <span className="ch-group-chev" aria-hidden="true">
            <Icon name="chevronDown" size={18} />
          </span>
        </button>
        <span className="ch-badges">
          {group.healthRelated && (
            <span className="ch-badge is-private">
              <Icon name="lock" size={12} stroke={2.4} />{' '}
              <Trans>Private</Trans>
            </span>
          )}
          {parentOption && (
            <span className="ch-badge is-if" title={t`Asked only when “${parentOption.label}” is picked`}>
              <Icon name="eye" size={12} />{' '}
              <Trans>After “{parentOption.label}”</Trans>
            </span>
          )}
        </span>
        {/* The rarer things, one step away: the only arrow left opens it. */}
        <MoreMenu
          label={title ? t`More for “${title}”` : t`More for this question`}
          items={[
            ...(canUp ? [{ label: t`Ask it earlier`, icon: 'chevronUp' as const, onClick: () => onMove(-1) }] : []),
            ...(canDown ? [{ label: t`Ask it later`, icon: 'chevronDown' as const, onClick: () => onMove(1) }] : []),
            { label: t`Remove this question`, icon: 'trash', onClick: onRemove, danger: true },
          ]}
        />
      </div>

      <div className="ch-group-fold">
        <div className="ch-group-body">
          <Step n={1} title={t`What do you ask customers?`}>
            <input
              id={`${group.key}-q`}
              className="ch-question"
              maxLength={120}
              value={group.question}
              onChange={(e) => set({ question: e.target.value })}
              placeholder={t`e.g. Which cut would you like?`}
              aria-label={t`The question customers see`}
            />
          </Step>

          <Step n={2} title={t`How many answers can they pick?`}>
            <div className="ch-pick" role="radiogroup" aria-label={t`How many answers they can pick`}>
              {(['ONE', 'MANY'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={group.kind === kind}
                  className={`ch-pick-card${group.kind === kind ? ' is-on' : ''}`}
                  onClick={() => set({ kind, maxPicks: kind === 'ONE' ? null : group.maxPicks })}
                >
                  <i className={kind === 'MANY' ? 'is-many' : ''} aria-hidden="true">
                    {group.kind === kind && <Icon name="check" size={11} stroke={3} />}
                  </i>
                  <span>
                    <strong>{kind === 'ONE' ? t`Just one` : t`One or more`}</strong>
                    <em>{kind === 'ONE' ? t`Like the length of hair` : t`Like extras to add`}</em>
                  </span>
                </button>
              ))}
            </div>
            <div className="ch-rules">
              {group.kind === 'MANY' && group.options.length > 1 && (
                <label className="ch-max">
                  <span><Trans>At most</Trans></span>
                  <Select
                    value={String(group.maxPicks ?? 0)}
                    onChange={(v) => set({ maxPicks: Number(v) || null })}
                    label={t`The most answers a customer may pick`}
                    options={[
                      { value: '0', label: t`Any number` },
                      ...Array.from({ length: group.options.length - 1 }, (_, i) => ({
                        value: String(i + 1),
                        label: `${i + 1} ${i === 0 ? 'answer' : 'answers'}`,
                      })),
                    ]}
                  />
                </label>
              )}
              <label className="ch-must">
                <Switch checked={group.required} onChange={(required) => set({ required })} label={t`Customers must answer`} />
                <span>
                  <strong><Trans>Customers must answer</Trans></strong>
                  <em>{group.required ? t`They can’t book without picking.` : t`They can skip it.`}</em>
                </span>
              </label>
            </div>
          </Step>

          <Step
            n={3}
            title={t`The answers`}
            hint={
              group.healthRelated
                ? t`Private answers are always free and take no extra time.`
                : t`Leave the price and time at 0 when an answer costs nothing extra.`
            }
          >
            <div className="ch-options">
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
                    onChange((g) => ({ ...g, fresh: false, options: g.options.filter((o) => o.key !== option.key) }))
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className="ch-add-option"
              disabled={group.options.length >= MAX_OPTIONS}
              onClick={() => onChange((g) => ({ ...g, fresh: false, options: [...g.options, blankOption()] }))}
            >
              <Icon name="plus" size={15} stroke={2.4} />
              {group.options.length >= MAX_OPTIONS ? t`That’s the most — ${MAX_OPTIONS} answers` : t`Add an answer`}
            </button>
          </Step>

          <div className={`ch-more${more ? ' is-open' : ''}`}>
            <button type="button" className="ch-more-toggle" onClick={() => setMore((was) => !was)} aria-expanded={more}>
              <Icon name="sliders" size={15} />
              <Trans>More options</Trans>
              {moreSet > 0 && <span className="ch-more-count"><Trans>{moreSet} set</Trans></span>}
              <Icon name="chevronDown" size={16} />
            </button>
            {more && (
              <div className="ch-more-body">
                <div className="sv-field">
                  <label htmlFor={`${group.key}-name`}><Trans>Short name on your bookings <em>optional</em></Trans>
                  </label>
                  <input
                    id={`${group.key}-name`}
                    maxLength={60}
                    value={group.name}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder={shortName({ name: '', question: group.question }) || t`e.g. Cut`}
                  />
                  <span className="sv-help">
                    <Trans>
                      Shown on the booking, like “{exampleName}: {exampleAnswer}”. Leave it empty to use the question.
                    </Trans>
                  </span>
                </div>

                {(conditions.length > 0 || group.showIf) && (
                  <div className="sv-field">
                    <label><Trans>When to ask it</Trans></label>
                    <Select
                      value={group.showIf ? `${group.showIf.groupKey}|${group.showIf.optionKey}` : 'always'}
                      onChange={(v) => {
                        if (v === 'always') return set({ showIf: null });
                        const [groupKey, optionKey] = v.split('|');
                        set({ showIf: { groupKey, optionKey } });
                      }}
                      label={t`When to ask this question`}
                      options={[{ value: 'always', label: t`Every time` }, ...conditions]}
                    />
                    <span className="sv-help">
                      {children.length > 0
                        ? askedAfter(children.map((c) => titleOf(c)))
                        : t`Ask it only after a certain answer above — like “Colour?” only after “Dye”.`}
                    </span>
                  </div>
                )}

                <label className="ch-must">
                  <Switch
                    checked={group.healthRelated}
                    onChange={makePrivate}
                    label={t`A private question: health or personal`}
                    disabled={Boolean(parent?.healthRelated)}
                  />
                  <span>
                    <strong><Trans>A private question</Trans></strong>
                    <em><Trans>For allergies, health or anything personal.</Trans></em>
                  </span>
                </label>
                {group.healthRelated && (
                  <p className="ch-private-note">
                    <Icon name="lock" size={15} />
                    <span>
                      <Trans>
                        Only you and the customer see these answers — never in an email or a phone alert — and they are
                        removed 30 days after the visit. They are always free and take no extra time.
                      </Trans>
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** One step of a question, numbered, with its title in plain words. */
function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="ch-step">
      <h5>
        <span>{n}</span>
        {title}
      </h5>
      {hint && <p className="ch-step-hint">{hint}</p>}
      {children}
    </section>
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
    <div className={`ch-option${option.available ? '' : ' is-off'}${free ? ' is-free' : ''}`}>
      <div className="ch-option-label">
        <span className="ch-mini"><Trans>Answer </Trans>{index + 1}</span>
        <input
          aria-label={t`Answer ${index + 1}`}
          maxLength={60}
          value={option.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={index === 0 ? t`e.g. Short` : index === 1 ? t`e.g. Long` : t`Another answer`}
        />
        {describing ? (
          <input
            className="ch-option-desc"
            aria-label={t`A short description of answer ${index + 1}`}
            maxLength={140}
            value={option.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={t`A short description — e.g. Below the shoulders`}
            autoFocus={!option.description}
          />
        ) : (
          <button type="button" className="link ch-describe" onClick={() => setDescribing(true)}>
            <Trans>+ Add a short description</Trans>
          </button>
        )}
      </div>
      {!free && (
        <>
          <div className={`ch-price${askPrice ? ' is-ask' : ''}${option.takesOff ? ' is-less' : ''}`}>
            <span className="ch-mini">{option.takesOff ? t`Takes off the price` : t`Adds to the price`}</span>
            <span className="sv-affix">
              <span>
                {option.takesOff ? '−' : '+'} {money.code}
              </span>
              <input
                type="number"
                min="0"
                step={money.exponent === 0 ? '1' : '0.01'}
                inputMode="decimal"
                aria-label={option.takesOff ? t`Taken off the price for answer ${index + 1}` : t`Added to the price for answer ${index + 1}`}
                value={option.price}
                onChange={(e) => onChange({ price: e.target.value.replace('-', '') })}
                placeholder="0"
              />
            </span>
            {askPrice ? (
              <em><Trans>Shops usually charge for this</Trans></em>
            ) : (
              <button type="button" className="link ch-flip" onClick={() => onChange({ takesOff: !option.takesOff })}>
                {option.takesOff ? t`or add to the price` : t`or take money off`}
              </button>
            )}
          </div>
          <div className="ch-minutes">
            <span className="ch-mini"><Trans>Adds time</Trans></span>
            <span className="sv-affix">
              <span>+</span>
              <input
                type="number"
                min="0"
                max="480"
                step="5"
                inputMode="numeric"
                aria-label={t`Extra minutes for answer ${index + 1}`}
                value={option.minutes}
                onChange={(e) => onChange({ minutes: e.target.value })}
                placeholder="0"
              />
              <span><Trans>min</Trans></span>
            </span>
          </div>
        </>
      )}
      <div className="ch-option-end">
        <label
          className="ch-offer"
          title={option.available ? t`Switch off when you can’t do it for now — customers see “Not available”.` : t`Switch on to offer it again.`}
        >
          <Switch
            checked={option.available}
            onChange={(available) => onChange({ available })}
            label={option.available ? t`Offered — switch off for “not available now”` : t`Not available now — switch on to offer it`}
          />
          <span>{option.available ? t`Offered` : t`Not now`}</span>
        </label>
        <button
          type="button"
          className="ch-option-remove"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={t`Remove answer ${index + 1}`}
          title={canRemove ? t`Remove this answer` : t`A question needs at least one answer`}
        >
          <Icon name="trash" size={14} />
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
  const ready = groups.filter((g) => titleOf(g) && g.options.some((o) => o.label.trim()));
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
        <strong><Trans>Try it as a customer</Trans></strong>
        <span><Trans>Tap the answers — the total changes</Trans></span>
      </div>
      <div className="ch-phone">
        {visible.map((g) => {
          const answered = g.options.filter((o) => picked.has(o.key)).length;
          return (
            <div key={g.key} className="ch-q">
              <div className="ch-q-head">
                <strong>{titleOf(g)}</strong>
                <span className={g.required && answered === 0 ? 'is-need' : ''}>
                  {g.kind === 'MANY' ? (g.maxPicks ? t`Choose up to ${g.maxPicks}` : t`Choose any`) : t`Pick 1`}
                  {g.required ? t` · Required` : ''}
                </span>
              </div>
              {g.healthRelated && (
                <p className="ch-q-private">
                  <Icon name="lock" size={12} />{' '}
                  <Trans>Only the shop sees this.</Trans>
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
                          <em><Trans>Not available</Trans></em>
                        ) : (
                          (price !== 0 || mins > 0) && (
                            <em>
                              {price !== 0 && `${price > 0 ? '+' : '−'}${money.format(Math.abs(price))}`}
                              {price !== 0 && mins > 0 && ' · '}
                              {mins > 0 && t`+${mins} min`}
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
            <span>{priceAtShop ? t`From` : t`Total`}</span>
            <strong>
              {basePriceMinor === null
                ? `${extra >= 0 ? '+' : '−'}${money.format(Math.abs(extra))}`
                : money.format(Math.max(0, basePriceMinor + extra))}
            </strong>
          </div>
          <div>
            <span><Trans>Takes</Trans></span>
            <strong>{durationMinutes + minutes}<Trans>min</Trans></strong>
          </div>
          <span className={`ch-total-state${missing ? ' is-need' : ''}`}>
            {missing ? t`${missing} to answer` : t`Ready to choose a time`}
          </span>
        </div>
      </div>
      {basePriceMinor === null && <p className="sv-help"><Trans>Give a price at a branch to see the full total.</Trans></p>}
    </div>
  );
}
