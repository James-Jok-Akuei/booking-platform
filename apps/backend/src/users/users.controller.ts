import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse } from '@nestjs/swagger';
import { ME_SELECT, MeDto } from './dto/user-response.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  // Any authenticated user (business, customer, or admin) can call this
  // to fetch their own account. Role-specific endpoints will use
  // @Roles(...) + RolesGuard on top of this same JwtAuthGuard.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOkResponse({ type: MeDto })
  // No declared return type: `createdAt` is a Date here and a string on the
  // wire, which is what MeDto describes (§128.11). The DTO is bound to
  // ME_SELECT instead, so dropping a field from the select breaks the build.
  async me(@CurrentUser() user: AuthenticatedUser) {
    const record = await this.prisma.user.findUnique({
      where: { id: user.userId },
      // One select, shared with the DTO that describes it (§128.5). It lived
      // inline here while §125 spent an hour looking for a missing imageUrl.
      select: ME_SELECT,
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
