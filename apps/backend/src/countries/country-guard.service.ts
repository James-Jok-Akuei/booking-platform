import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CountriesService } from './countries.service';
import { countryChecks } from './country-readiness';

/**
 * Refuses to start if the countries are not in order (§315), in the spirit
 * of `CurrencyGuard`: exactly one default country, and it is live; and every
 * live country passes every check the console shows before switching one on.
 * A live country with a wrong clock or no pack would put bookings at the
 * wrong hour or take numbers no network can pay, which is worse than not
 * starting.
 */
@Injectable()
export class CountryGuard implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesService,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.countries.all();
    const defaults = rows.filter((c) => c.isDefault);
    if (defaults.length !== 1) {
      throw new Error(
        `There must be exactly one default country; there are ${defaults.length}. ` +
          'Run prisma/reference-data.sql to add Rwanda.',
      );
    }
    if (!defaults[0].isLive) throw new Error(`The default country, ${defaults[0].name}, is not live.`);

    const problems: string[] = [];
    for (const country of rows.filter((c) => c.isLive)) {
      const places = await this.prisma.district.count({ where: { province: { countryCode: country.code }, isLive: true } });
      for (const check of countryChecks(country, places)) {
        if (!check.ok) problems.push(`${country.name}: ${check.words}`);
      }
    }
    if (problems.length > 0) {
      throw new Error(`A live country is not ready, so the server will not start:\n- ${problems.join('\n- ')}`);
    }
    this.countries.describe(rows);
  }
}
