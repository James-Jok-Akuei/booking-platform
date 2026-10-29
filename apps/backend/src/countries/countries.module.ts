import { Global, Module } from '@nestjs/common';
import { AdminCountriesController, CountriesController } from './countries.controller';
import { AdminCountriesService } from './admin-countries.service';
import { CountriesService } from './countries.service';
import { CountryGuard } from './country-guard.service';

// Global: nearly every feature asks which country a shop is in — for its
// clock, its phone numbers, its networks, its papers (§315).
@Global()
@Module({
  controllers: [CountriesController, AdminCountriesController],
  providers: [CountriesService, CountryGuard, AdminCountriesService],
  exports: [CountriesService],
})
export class CountriesModule {}
