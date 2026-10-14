import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessMemberRole } from '@prisma/client';
import { ALL_BRANCHES_KEY, BUSINESS_ROLES_KEY } from '../../common/decorators/business-roles.decorator';
import { assertAllBranches } from '../branch-scope';
import { BUSINESS_CONTEXT_KEY } from '../../common/decorators/current-business.decorator';
import { BusinessAccessService } from '../business-access.service';

/**
 * Resolves the caller's membership and enforces `@BusinessRoles(...)`.
 *
 * Runs after JwtAuthGuard (which establishes *who*) and RolesGuard (which
 * establishes that they hold a BUSINESS account). This guard answers the third
 * question: what are they allowed to do *inside* their business.
 *
 * Two jobs, deliberately combined:
 *
 * 1. **Resolve.** Look up the caller's ACTIVE membership and attach it to the
 *    request. No active membership is a 403 — a business account with no
 *    membership (removed, or mid-invitation) can reach nothing.
 * 2. **Authorise.** If the handler declares roles, the caller's role must be
 *    among them.
 *
 * Doing both here is what stops every controller method from re-deriving the
 * business and re-checking the role by hand, which is how permission logic
 * drifts out of sync between endpoints.
 */
@Injectable()
export class BusinessRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: BusinessAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // JwtAuthGuard runs first and rejects anonymous callers, so this only
    // trips if the guards are ever wired in the wrong order.
    if (!user?.userId) return false;

    // Throws ForbiddenException when there is no active membership.
    const membership = await this.access.requireActiveMembership(user.userId);

    request[BUSINESS_CONTEXT_KEY] = {
      membershipId: membership.id,
      businessId: membership.businessProfileId,
      role: membership.role,
      scope: membership.scope,
    };

    const required = this.reflector.getAllAndOverride<BusinessMemberRole[]>(
      BUSINESS_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No declaration means "any active member" — the membership check above has
    // already run, so this is still not an open door.
    if (required && required.length > 0 && !required.includes(membership.role)) return false;

    // Whole-business changes need every branch (§277). Said in words, not a bare 403.
    const allBranches = this.reflector.getAllAndOverride<boolean>(ALL_BRANCHES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allBranches) assertAllBranches(membership.scope);

    return true;
  }
}
