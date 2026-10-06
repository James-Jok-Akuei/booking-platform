import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { RouteDto, RouteQueryDto } from './dto/route.dto';
import { RoutingService } from './routing.service';

/**
 * Open to anyone, like availability: a customer deciding whether a shop is
 * too far has not signed in yet. Nothing about the customer is kept.
 */
@Controller('locations')
@ApiErrors({ validation: true, notFound: true })
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Get(':id/route')
  @ApiOkResponse({ type: RouteDto })
  route(@Param('id', ParseUUIDPipe) id: string, @Query() query: RouteQueryDto) {
    return this.routing.toLocation(id, { lat: query.lat, lng: query.lng });
  }
}
