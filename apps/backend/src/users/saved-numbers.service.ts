import { Injectable, NotFoundException } from '@nestjs/common';
import { MobileMoneyProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Digits only, the shape the operator takes (§109.2). */
const toMsisdn = (typed: string) => typed.replace(/\D/g, '');

/**
 * Mobile money numbers somebody has used before (§124.2).
 *
 * This is a keyboard shortcut, not a payment method, and the distinction is
 * worth keeping in front of whoever reads this next. No token, no mandate, no
 * stored credential: MTN charges by prompting the handset, so there is nothing
 * here that could be used by anybody not holding the phone. The number is still
 * sent to the same endpoint and validated by the same DTO.
 */
@Injectable()
export class SavedNumbersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Most recently used first, then most recently added. */
  list(userId: string) {
    return this.prisma.savedPaymentNumber.findMany({
      where: { userId },
      orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        phoneNumber: true,
        provider: true,
        label: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Saves a number, or updates the label on one already there.
   *
   * Normalised before storing, so the same number cannot be saved twice wearing
   * different spaces — which is what the unique index would otherwise allow.
   */
  async save(
    userId: string,
    input: { phoneNumber: string; label?: string; provider?: MobileMoneyProvider },
  ) {
    const phoneNumber = toMsisdn(input.phoneNumber);
    return this.prisma.savedPaymentNumber.upsert({
      where: { userId_phoneNumber: { userId, phoneNumber } },
      create: {
        userId,
        phoneNumber,
        label: input.label ?? null,
        provider: input.provider ?? null,
      },
      update: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
      },
      select: { id: true, phoneNumber: true, provider: true, label: true },
    });
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.savedPaymentNumber.deleteMany({
      where: { id, userId },
    });
    if (count === 0) throw new NotFoundException('Number not found.');
    return { message: 'Number removed.' };
  }

  /**
   * Marks a number as just used, so it floats to the top next time.
   *
   * Best-effort and never throws: a payment that succeeded must not be reported
   * as failed because a convenience column could not be written.
   */
  async markUsed(userId: string, typed: string) {
    const phoneNumber = toMsisdn(typed);
    await this.prisma.savedPaymentNumber
      .updateMany({ where: { userId, phoneNumber }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
}
