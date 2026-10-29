import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AddressSearchService } from './address-search.service';
import { AddressSearchDto, AddressSearchQueryDto } from './dto/address.dto';
import { CountriesService } from '../countries/countries.service';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Finding an address as it is typed (§172, §174).
 *
 * Signed in only, unlike the road distance: its uses are the address a
 * customer saves for the weekly offers email, and a business's branch address
 * (§228) — both need an account — and the map search is a shared, fair-use
 * service for the WHOLE platform, which is not something to hand to anyone
 * with a script.
 */
@Controller('addresses')
@UseGuards(JwtAuthGuard)
@ApiErrors({ auth: true, validation: true })
export class AddressSearchController {
  constructor(
    private readonly addresses: AddressSearchService,
    private readonly countries: CountriesService,
  ) {}

  /** In the searcher's own country (§315): a shop's branch address, or a customer's home. */
  @Get()
  @ApiOkResponse({ type: AddressSearchDto })
  async search(@Query() query: AddressSearchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.addresses.search(query.q, await this.countries.ofUser(user.userId));
  }
}
