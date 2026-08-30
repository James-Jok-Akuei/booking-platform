import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BusinessMemberStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  // Any authenticated user (business, customer, or admin) can call this
  // to fetch their own account. Role-specific endpoints will use
  // @Roles(...) + RolesGuard on top of this same JwtAuthGuard.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const record = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        // The direct 1:1 businessProfile relation was replaced by
        // BusinessMembership, so a business user's profile is reached through
        // their membership — which also surfaces their role in it.
        //
        // Filtered to ACTIVE: the relation is a list because REMOVED rows
        // accumulate as history, but at most one is ever active, and that is
        // the only one that grants anything.
        businessMemberships: {
          where: { status: BusinessMemberStatus.ACTIVE },
          select: {
            id: true,
            role: true,
            status: true,
            businessProfile: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });

    if (!record) return null;

    // Collapse the one-element list back to a single object. The list is an
    // artefact of how the partial unique index has to be modelled in Prisma;
    // callers still see one membership or null, so the response shape is
    // unchanged from before that index existed.
    const { businessMemberships, ...rest } = record;
    return { ...rest, businessMembership: businessMemberships[0] ?? null };
  }
}
