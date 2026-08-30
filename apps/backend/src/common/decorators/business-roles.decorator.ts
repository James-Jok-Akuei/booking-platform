import { SetMetadata } from '@nestjs/common';
import { BusinessMemberRole } from '@prisma/client';

export const BUSINESS_ROLES_KEY = 'businessRoles';

/**
 * Declares which business roles may call a handler.
 *
 * Distinct from `@Roles()`, and both are usually needed. `@Roles(BUSINESS)`
 * asks "is this account a business account at all?" — a platform-level question
 * about the User. `@BusinessRoles(OWNER, MANAGER)` asks "what is this person
 * within their business?" — an organisational question about the membership.
 *
 * Applied with no arguments, or omitted entirely, any ACTIVE member passes.
 * BusinessRolesGuard still requires an active membership either way, so a
 * handler can never be reached by someone with no business at all.
 */
export const BusinessRoles = (...roles: BusinessMemberRole[]) =>
  SetMetadata(BUSINESS_ROLES_KEY, roles);
