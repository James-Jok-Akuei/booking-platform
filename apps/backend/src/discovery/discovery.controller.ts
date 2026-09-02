import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { DiscoveryService } from './discovery.service';
import { DiscoverLocationsDto } from './dto/discover-locations.dto';

/**
 * The customer front door.
 *
 * Same posture as `GET /locations/:id/availability` and
 * `GET /locations/:id/reviews` (§13.2): `OptionalJwtAuthGuard`, so it is
 * reachable with no token at all. A customer has to be able to find a business
 * before they have any reason to sign up — requiring a token here would make
 * the platform unusable to exactly the people it needs to reach.
 *
 * Nothing here varies by viewer, so the guard attaches a user it never reads.
 * It is used rather than no guard so a token that IS sent is still verified,
 * and so this route cannot later grow a viewer-specific branch without one.
 */
@Controller('discover')
@UseGuards(OptionalJwtAuthGuard)
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('locations')
  search(@Query() query: DiscoverLocationsDto) {
    return this.discovery.search(query);
  }

  @Get('locations/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.discovery.findOne(id);
  }
}
