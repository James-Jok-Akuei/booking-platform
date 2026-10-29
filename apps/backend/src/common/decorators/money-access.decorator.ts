import { SetMetadata } from '@nestjs/common';

export const MONEY_ACCESS_KEY = 'moneyAccess';

/**
 * Money access (§317): an administrator reaches these routes only with it —
 * checked by `RolesGuard`, which reads them from the database on every
 * request, so turning it off takes effect at once. Sellers on a shared route
 * are not affected. `@MoneyAccess(false)` opens one route of a money controller.
 */
export const MoneyAccess = (required = true) => SetMetadata(MONEY_ACCESS_KEY, required);
