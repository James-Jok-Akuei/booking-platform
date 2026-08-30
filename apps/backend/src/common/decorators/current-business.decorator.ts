import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { BusinessMemberRole } from '@prisma/client';

/** The caller's resolved place within their business, attached by BusinessRolesGuard. */
export interface BusinessContext {
  membershipId: string;
  businessId: string;
  role: BusinessMemberRole;
}

export const BUSINESS_CONTEXT_KEY = 'businessContext';

/**
 * The caller's membership, already resolved by BusinessRolesGuard.
 *
 * Using this instead of re-deriving the business from the user id saves the
 * repeat lookup the guard just performed, and guarantees the handler and the
 * permission check are talking about the same membership.
 */
export const CurrentBusiness = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BusinessContext => {
    const request = ctx.switchToHttp().getRequest();
    return request[BUSINESS_CONTEXT_KEY];
  },
);
