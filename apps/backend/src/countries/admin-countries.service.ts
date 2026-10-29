import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_BUSINESS } from '../business/business-status';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CountriesService, type CountryRow } from './countries.service';
import { countryChecks } from './country-readiness';
import { countryView } from './country-view';
import type { AdminCountryDto, UpdateCountryDto } from './dto/countries.dto';

/**
 * The console's view of the countries (§315). A country is added in code —
 * its pack and its reference data — never here; the console shows each one's
 * settings and shops, sets its own fee, and switches it on once every check
 * passes.
 */
@Injectable()
export class AdminCountriesService {
  private readonly logger = new Logger(AdminCountriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async list(): Promise<AdminCountryDto[]> {
    const rows = await this.countries.all();
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async update(user: AuthenticatedUser, code: string, dto: UpdateCountryDto): Promise<AdminCountryDto> {
    const country = await this.countries.get(code);

    if (dto.platformFeePercentage !== undefined) {
      await this.settings.setCountryFee(country.code, dto.platformFeePercentage, user);
    }

    if (dto.isLive !== undefined && dto.isLive !== country.isLive) {
      if (dto.isLive) {
        const failing = countryChecks(country, await this.places(country.code)).filter((c) => !c.ok);
        if (failing.length > 0) {
          throw new BadRequestException(`${country.name} cannot be switched on yet: ${failing.map((c) => c.words).join(' ')}`);
        }
      } else {
        if (country.isDefault) throw new BadRequestException(`${country.name} is the default country, so it is always on.`);
        const live = await this.prisma.businessProfile.count({ where: { countryCode: country.code, ...PUBLIC_BUSINESS } });
        if (live > 0) {
          throw new BadRequestException(
            `${live} ${live === 1 ? 'shop is' : 'shops are'} live in ${country.name}. ` +
              'Pause or suspend them first: switching the country off would hide them from customers without telling them.',
          );
        }
      }
      await this.prisma.country.update({
        where: { code: country.code },
        data: { isLive: dto.isLive, ...(dto.isLive ? { liveSince: new Date() } : {}) },
      });
      this.countries.forget();
      this.logger.log(`${country.name} switched ${dto.isLive ? 'on' : 'off'} by ${user.email}.`);
    }

    return this.view(await this.countries.get(country.code));
  }

  private places(code: string) {
    return this.prisma.district.count({ where: { isLive: true, province: { countryCode: code } } });
  }

  private async view(row: CountryRow): Promise<AdminCountryDto> {
    const [shops, liveShops, places, effective] = await Promise.all([
      this.prisma.businessProfile.count({ where: { countryCode: row.code } }),
      this.prisma.businessProfile.count({ where: { countryCode: row.code, ...PUBLIC_BUSINESS } }),
      this.places(row.code),
      this.settings.getPlatformFeePercentage(row.code),
    ]);
    return {
      ...countryView(row),
      isLive: row.isLive,
      liveSince: row.liveSince?.toISOString() ?? null,
      platformFeePercentage: row.platformFeePercentage?.toFixed(2) ?? null,
      effectiveFeePercentage: effective.toFixed(2),
      shops,
      liveShops,
      places,
      checks: countryChecks(row, places),
    };
  }
}
