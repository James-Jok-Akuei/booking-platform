import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AddressSearchService } from './address-search.service';
import { AddressSearchDto, AddressSearchQueryDto } from './dto/address.dto';

/**
 * Finding an address as it is typed (§172, §174).
 *
 * Signed in only, unlike the road distance: its one use is the address a
 * customer saves for the weekly offers email, which needs an account — and the
 * map search is a shared, fair-use service for the WHOLE platform, which is
 * not something to hand to anyone with a script.
 */
@Controller('addresses')
@UseGuards(JwtAuthGuard)
@ApiErrors({ auth: true, validation: true })
export class AddressSearchController {
  constructor(private readonly addresses: AddressSearchService) {}

  @Get()
  @ApiOkResponse({ type: AddressSearchDto })
  search(@Query() query: AddressSearchQueryDto) {
    return this.addresses.search(query.q);
  }
}
