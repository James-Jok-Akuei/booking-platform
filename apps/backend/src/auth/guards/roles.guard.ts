import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Role checks, from the token — except for ADMIN, which is read live (§99.4).
 *
 * The JWT carries the role and `JwtStrategy` does no database read, which is
 * what keeps every request cheap. The cost is that a role change does not
 * reach an access token already issued.
 *
 * For a customer or business that is harmless: nothing demotes them, and the
 * token expires in minutes. For an administrator it is not. Admin access is
 * taken away from someone precisely when they are no longer trusted with it,
 * and "they keep it for another fifteen minutes" is not an acceptable answer to
 * that — it was found by revoking an administrator and watching their existing
 * token still open `/admin/reviews`.
 *
 * So the live check is **scoped to ADMIN**. Admin routes are an internal
 * console used by a handful of people; one query there costs nothing. Customer
 * and business routes, which carry the traffic, are untouched.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // no @Roles() decorator => open to any authenticated user
    }

    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles.includes(user?.role)) return false;

    // The token says ADMIN. Confirm the account still is one.
    if (user?.role === UserRole.ADMIN) {
      const live = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { role: true },
      });
      return live?.role === UserRole.ADMIN;
    }

    return true;
  }
}
