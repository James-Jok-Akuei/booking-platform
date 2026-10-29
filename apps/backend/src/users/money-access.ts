import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Money access (§317): who may see and move the platform's money — the
 * statistics, the money book, refunds, payouts and payout numbers, the fee
 * and rate settings, the Overview's money figures. The primary administrator
 * always; any other administrator only once the primary has turned it on.
 */

/** The code a refusal carries, so the console can say why rather than "forbidden". */
export const MONEY_ACCESS_REQUIRED = 'MONEY_ACCESS_REQUIRED';

export const MONEY_ACCESS_REFUSAL =
  'This is for administrators with money access. The primary administrator can turn it on for you, under Users.';

export const hasMoneyAccess = (user: { role: UserRole | string; isPrimaryAdmin: boolean; moneyAccess: boolean } | null) =>
  !!user && user.role === UserRole.ADMIN && (user.isPrimaryAdmin || user.moneyAccess);

/** The administrators a notice about money goes to: only those who can act on it. */
export const MONEY_ADMINS = {
  role: UserRole.ADMIN,
  closedAt: null,
  OR: [{ isPrimaryAdmin: true }, { moneyAccess: true }],
} satisfies Prisma.UserWhereInput;

export const moneyRefusal = () =>
  new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: MONEY_ACCESS_REQUIRED, message: MONEY_ACCESS_REFUSAL });

/** Whether this administrator, as they are now in the database, has money access. */
export async function moneyAccessOf(prisma: PrismaService, userId: string) {
  return hasMoneyAccess(
    await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isPrimaryAdmin: true, moneyAccess: true } }),
  );
}

/** For a route that is not all money — a country's fee among its other settings. */
export async function assertMoneyAccess(prisma: PrismaService, userId: string) {
  if (!(await moneyAccessOf(prisma, userId))) throw moneyRefusal();
}
