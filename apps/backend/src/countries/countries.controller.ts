import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminCountriesService } from './admin-countries.service';
import { CountriesService } from './countries.service';
import { AdminCountryDto, CountryDto, UpdateCountryDto } from './dto/countries.dto';
import { countryView } from './country-view';

/** The countries customers can find shops in (§315), the default first. Public. */
@Controller('countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  @ApiOkResponse({ type: CountryDto, isArray: true })
  async list(): Promise<CountryDto[]> {
    return (await this.countries.live()).map(countryView);
  }
}

/** Every country, for the console: its settings, its shops, whether it could be on (§315). */
@Controller('admin/countries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminCountriesController {
  constructor(private readonly admin: AdminCountriesService) {}

  @Get()
  @ApiOkResponse({ type: AdminCountryDto, isArray: true })
  list(): Promise<AdminCountryDto[]> {
    return this.admin.list();
  }

  /** Its own fee, or switching it on or off. Bookings already made keep the fee they were made with. */
  @Patch(':code')
  @ApiOkResponse({ type: AdminCountryDto })
  update(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string, @Body() dto: UpdateCountryDto): Promise<AdminCountryDto> {
    return this.admin.update(user, code, dto);
  }
}
