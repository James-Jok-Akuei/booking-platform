import { packFor } from './packs';
import type { CountryRow } from './countries.service';
import type { CountryDto } from './dto/countries.dto';

/** A country as the apps read it. */
export const countryView = (c: CountryRow): CountryDto => ({
  code: c.code,
  name: c.name,
  callingCode: c.callingCode,
  currency: c.currency,
  timeZone: c.timeZone,
  locales: c.locales,
  networks: c.networks,
  phoneExample: c.phoneExample,
  mobileDigits: packFor(c.code)?.mobileDigits ?? 9,
  networkPrefixes: { ...(packFor(c.code)?.operatorPrefixes ?? {}) },
  isDefault: c.isDefault,
});
