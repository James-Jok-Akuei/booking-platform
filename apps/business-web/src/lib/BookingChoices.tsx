import type { Appointment } from '../api/business';
import type { useMoney } from '../money';
import { Icon } from '../ui/Icon';
import './booking-choices.css';

type Pick = NonNullable<Appointment['choices']>[number];

/** "+RWF 5,000 · +30 min", or nothing for a free answer. */
function adds(pick: Pick, format: (minor: number) => string) {
  return [
    pick.priceMinor > 0 && `+${format(pick.priceMinor)}`,
    pick.priceMinor < 0 && `−${format(-pick.priceMinor)}`,
    pick.extraMinutes > 0 && `+${pick.extraMinutes} min`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * What the customer chose (§300), as the booking keeps it: each answer by
 * the shop's own name for the question, what it added, the private answers
 * in red — for the shop's eyes, never to be passed on (§300.6) — and the
 * customer's note.
 */
export function BookingChoices({
  a,
  money,
  heading = true,
}: {
  a: Appointment;
  money: ReturnType<typeof useMoney>;
  heading?: boolean;
}) {
  const picks = (a.choices ?? []) as Pick[];
  const privateOnes = a.healthChoices ?? [];
  if (picks.length === 0 && privateOnes.length === 0 && !a.customerNote && !a.healthChoicesRemovedAt) return null;
  const format = (minor: number) => money.format(minor, a.currency);

  const byGroup = new Map<string, string[]>();
  for (const pick of privateOnes) byGroup.set(pick.group, [...(byGroup.get(pick.group) ?? []), pick.option]);

  return (
    <section className="bc">
      {heading && (
        <h3 className="ap-drawer-h bc-h">
          What they chose
          {a.choicesChangedAt && (
            <span className="bc-changed" title={new Date(a.choicesChangedAt).toLocaleString()}>
              <Icon name="pencil" size={12} /> changed since booking
            </span>
          )}
        </h3>
      )}
      {picks.length > 0 && (
        <ul className="bc-list">
          {picks.map((pick) => (
            <li key={pick.optionId}>
              <span className="bc-q">{pick.group}</span>
              <strong>{pick.option}</strong>
              {(pick.priceMinor !== 0 || pick.extraMinutes > 0) && <em>{adds(pick, format)}</em>}
            </li>
          ))}
        </ul>
      )}
      {privateOnes.length > 0 && (
        <div className="bc-private" role="note">
          <Icon name="lock" size={15} />
          <div>
            <span>Private — for you only. Never share or send it on.</span>
            {[...byGroup.entries()].map(([group, options]) => (
              <strong key={group}>
                {group}: {options.join(', ')}
              </strong>
            ))}
          </div>
        </div>
      )}
      {a.healthChoicesRemovedAt && (
        <p className="bc-removed">
          <Icon name="lock" size={13} /> Private answers were removed 30 days after the visit.
        </p>
      )}
      {a.customerNote && (
        <blockquote className="bc-note">
          <Icon name="message" size={15} />
          <span>{a.customerNote}</span>
        </blockquote>
      )}
    </section>
  );
}

/** Small marks for a booking's row: private answers, and a note (§300). */
export function ChoiceMarks({ a }: { a: Appointment }) {
  const picks = (a.choices ?? []) as Pick[];
  const privateCount = a.healthChoices?.length ?? 0;
  if (picks.length === 0 && privateCount === 0 && !a.customerNote) return null;
  return (
    <span className="bc-marks">
      {picks.length > 0 && (
        <span className="bc-mark" title={picks.map((p) => `${p.group}: ${p.option}`).join('\n')}>
          <Icon name="sliders" size={12} /> {picks.length}
        </span>
      )}
      {privateCount > 0 && (
        <span className="bc-mark is-private" title="Private answers — open the booking">
          <Icon name="lock" size={12} />
        </span>
      )}
      {a.customerNote && (
        <span className="bc-mark" title={a.customerNote}>
          <Icon name="message" size={12} />
        </span>
      )}
    </span>
  );
}
