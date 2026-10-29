import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { CountriesService } from '../countries/countries.service';
import { RequestedCountry } from '../countries/requested-country.decorator';
import { ProvinceDto, PUBLIC_PROVINCE_SELECT } from './dto/place-response.dto';

/**
 * Where a business can be, and what a customer can filter by (§104).
 *
 * Public and unauthenticated, for the same reason the category taxonomy is: a
 * customer browses by place before they have an account, and a business picks
 * one during onboarding.
 *
 * Districts come nested inside their province. The two are never useful apart
 * — a district list with no province is thirty names in no order anyone thinks
 * in.
 */
@Controller('places')
export class PlacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesService,
  ) {}

  /** One country's places (§315): the one asked for (`X-Country`, `?country=`), or the default. */
  @Get('provinces')
  @ApiOkResponse({ type: ProvinceDto, isArray: true })
  @ApiQuery({ name: 'country', required: false, description: 'An ISO country code (§315), or the X-Country header; the default country when not given.' })
  async findAll(@RequestedCountry() requested: string | undefined) {
    const country = await this.countries.resolve(requested);
    return this.prisma.province.findMany({
      // A province with nothing open in it is noise in a filter row.
      where: { countryCode: country.code, districts: { some: { isLive: true } } },
      orderBy: { name: 'asc' },
      // One select, shared with the DTO that describes it (§128.5).
      select: PUBLIC_PROVINCE_SELECT,
    });
  }
}
