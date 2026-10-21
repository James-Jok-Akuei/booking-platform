import { Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse } from '@nestjs/swagger';
import { ME_SELECT, MeDto, ToursDueDto } from './dto/user-response.dto';
import { TOUR_NAMES, type TourName } from './tours';
import { scopeOf } from '../business/branch-scope';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  // Any authenticated user (business, customer, or admin) can call this
  // to fetch their own account. Role-specific endpoints will use
  // @Roles(...) + RolesGuard on top of this same JwtAuthGuard.
  @UseGuards(JwtAuthGuard)
  // The guard is on the METHOD here, not the class, so the 401 is declared
  // here too — the only place in the API where that is true.
  @ApiErrors({ auth: true })
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
    const membership = businessMemberships[0];
    if (!membership) return { ...rest, businessMembership: null };
    // The branches as the screens use them (§277): the owner always has every one.
    const { locations, ...kept } = membership;
    const scope = scopeOf({ ...membership, locations });
    return {
      ...rest,
      businessMembership: { ...kept, allLocations: scope.allLocations, locationIds: scope.locationIds },
    };
  }

  /**
   * A welcome tour finished or skipped (§307): no longer due, on any device.
   * Taking it again from Help or Account changes nothing here.
   */
  @UseGuards(JwtAuthGuard)
  @ApiErrors({ auth: true, notFound: true })
  @Post('me/tours/:name/done')
  @HttpCode(200)
  @ApiOkResponse({ type: ToursDueDto })
  async tourDone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('name') name: string,
  ): Promise<ToursDueDto> {
    if (!TOUR_NAMES.includes(name as TourName)) throw new NotFoundException('There is no tour by that name.');
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { toursDue: true } });
    const toursDue = record.toursDue.filter((due) => due !== name);
    if (toursDue.length !== record.toursDue.length) {
      await this.prisma.user.update({ where: { id: user.userId }, data: { toursDue } });
    }
    return { toursDue };
  }
}
