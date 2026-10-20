import { Prisma } from '@prisma/client';
import { CHOICE_GROUPS_SELECT } from './dto/service-choices.dto';
import { ChoiceGroup } from './service-choices';

type Db = Pick<Prisma.TransactionClient, 'serviceChoiceGroup' | 'serviceChoiceOption'>;

/** A service's questions as stored, in order (§300). */
export function loadChoiceGroups(db: Db, serviceId: string): Promise<ChoiceGroup[]> {
  return db.serviceChoiceGroup.findMany({ where: { serviceId }, ...CHOICE_GROUPS_SELECT });
}

/**
 * Writes the questions `planChoiceGroups` checked, over what the service had.
 *
 * Kept ones are updated in place, so their ids — which a customer who opened
 * the page a minute ago is about to send — stay the same; left-out ones are
 * removed; new ones are added. Question by question, in order, because a
 * question can only depend on an answer ABOVE it: that answer always exists
 * by the time the question pointing at it is written.
 *
 * Bookings never point at these rows; they keep their own copy (§300), so
 * removing an answer changes no booking.
 */
export async function saveChoiceGroups(
  tx: Db,
  serviceId: string,
  planned: readonly ChoiceGroup[],
  existing: readonly ChoiceGroup[],
): Promise<void> {
  const hadGroup = new Set(existing.map((group) => group.id));
  const hadOption = new Set(existing.flatMap((group) => group.options.map((option) => option.id)));

  await tx.serviceChoiceGroup.deleteMany({
    where: { serviceId, id: { notIn: planned.map((group) => group.id) } },
  });
  await tx.serviceChoiceOption.deleteMany({
    where: {
      group: { serviceId },
      id: { notIn: planned.flatMap((group) => group.options.map((option) => option.id)) },
    },
  });

  for (const [position, group] of planned.entries()) {
    const data = {
      position,
      name: group.name,
      question: group.question,
      kind: group.kind,
      required: group.required,
      maxPicks: group.maxPicks,
      healthRelated: group.healthRelated,
      showIfOptionId: group.showIfOptionId,
      suggestionKey: group.suggestionKey,
    };
    if (hadGroup.has(group.id)) {
      await tx.serviceChoiceGroup.update({ where: { id: group.id }, data });
    } else {
      await tx.serviceChoiceGroup.create({ data: { id: group.id, serviceId, ...data } });
    }

    for (const [at, option] of group.options.entries()) {
      const fields = {
        position: at,
        label: option.label,
        description: option.description,
        priceMinor: option.priceMinor,
        extraMinutes: option.extraMinutes,
        available: option.available,
      };
      if (hadOption.has(option.id)) {
        await tx.serviceChoiceOption.update({ where: { id: option.id }, data: fields });
      } else {
        await tx.serviceChoiceOption.create({ data: { id: option.id, groupId: group.id, ...fields } });
      }
    }
  }
}
