import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { DiscoveryService } from './discovery.service';
import { ApiOkResponse } from '@nestjs/swagger';
import { DiscoveryPageDto } from './dto/discovery-response.dto';
import { DiscoverLocationsDto } from './dto/discover-locations.dto';
import { DiscoveredServicePageDto, ShopfrontDto } from './dto/discovery-response.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

/**
 * The customer front door.
 *
 * Same posture as `GET /locations/:id/availability` and
 * `GET /locations/:id/reviews` (§13.2): `OptionalJwtAuthGuard`, so it is
 * reachable with no token at all. A customer has to be able to find a business
 * before they have any reason to sign up — requiring a token here would make
 * the platform unusable to exactly the people it needs to reach.
 *
 * One thing DOES vary by viewer now, and the guard is why it could: each result
 * says whether this customer has saved it (§120). That branch is exactly what
 * this comment used to say the guard was here to make possible, so it is written
 * down rather than quietly deleted — a signed-out caller still gets everything,
 * minus the one field that has no meaning without a reader.
 */
@Controller('discover')
@UseGuards(OptionalJwtAuthGuard)
@ApiErrors({ validation: true, notFound: true })
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('locations')
  @ApiOkResponse({ type: DiscoveryPageDto })
  search(
    @Query() query: DiscoverLocationsDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.discovery.search(query, user?.userId);
  }

  /**
   * Services across every shop (§135.2). The same query as the place search,
   * so the two narrow by the same rules and cannot disagree about what is open.
   */
  @Get('services')
  @ApiOkResponse({ type: DiscoveredServicePageDto })
  searchServices(@Query() query: DiscoverLocationsDto) {
    return this.discovery.searchServices(query);
  }

  @Get('locations/:id')
  @ApiOkResponse({ type: ShopfrontDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.discovery.findOne(id, user?.userId);
  }
}
