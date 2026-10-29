import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BusinessMemberStatus, MobileMoneyProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { packFor, type CountryPack } from './packs';

/** A country's row, as the rest of the server reads it. */
export type CountryRow = {
  code: string;
  name: string;
  callingCode: string;
  currency: string;
  timeZone: string;
  locales: string[];
  networks: MobileMoneyProvider[];
  phoneExample: string;
  platformFeePercentage: Prisma.Decimal | null;
  isLive: boolean;
  isDefault: boolean;
  liveSince: Date | null;
};

/** How long the rows are kept before they are read again — the console's changes show within it. */
const FRESH_MS = 60_000;

/**
 * The countries (§315), read whole and kept for a minute: a handful of rows
 * asked about on nearly every request — which clock a shop keeps, which
 * phone numbers it accepts, which country a visitor is in. Everything that
 * differs across a border goes through here, so no other file needs to know
 * which country it is in.
 */
@Injectable()
export class CountriesService {
  private readonly logger = new Logger(CountriesService.name);
  private rows = new Map<string, CountryRow>();
  private readAt = 0;
  private reading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Read again on the next question — after the console changed a country. */
  forget() {
    this.readAt = 0;
  }

  private async fresh() {
    if (Date.now() - this.readAt < FRESH_MS && this.rows.size > 0) return;
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    await this.reading;
  }

  private async read() {
    const rows = await this.prisma.country.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    this.rows = new Map(rows.map((r) => [r.code, r]));
    this.readAt = Date.now();
  }

  /** Every country, the default first. */
  async all(): Promise<CountryRow[]> {
    await this.fresh();
    return [...this.rows.values()];
  }

  /** The countries customers can find shops in, the default first. */
  async live(): Promise<CountryRow[]> {
    return (await this.all()).filter((c) => c.isLive);
  }

  /** One country, or a 404. */
  async get(code: string): Promise<CountryRow> {
    await this.fresh();
    const row = this.rows.get(code.toUpperCase());
    if (!row) throw new NotFoundException(`No country "${code}".`);
    return row;
  }

  /**
   * The country a visitor who has not chosen one is in, and the one new shops
   * start in. `CountryGuard` makes sure there is exactly one, and that it is live.
   */
  async defaultCountry(): Promise<CountryRow> {
    const row = (await this.all()).find((c) => c.isDefault);
    if (!row) throw new Error('No default country. The countries reference data is missing (prisma/reference-data.sql).');
    return row;
  }

  /**
   * The country a public request is about: the one it asked for (the
   * `X-Country` header, or `?country=`), if that is a live country; otherwise
   * the default. Never a 4xx — an app asking for a country that is not
   * switched on yet still gets an answer, about the one that is.
   */
  async resolve(requested?: string | null): Promise<CountryRow> {
    if (requested) {
      await this.fresh();
      const row = this.rows.get(requested.trim().toUpperCase());
      if (row?.isLive) return row;
    }
    return this.defaultCountry();
  }

  /** The country a shop is in. */
  async ofBusiness(businessId: string): Promise<CountryRow> {
    const shop = await this.prisma.businessProfile.findUnique({ where: { id: businessId }, select: { countryCode: true } });
    if (!shop) throw new NotFoundException('Business not found.');
    return this.get(shop.countryCode);
  }

  /**
   * The country a person is in, as far as the platform knows (§315): a shop
   * member's is their shop's, a customer's their home district's, and anyone
   * else's — an administrator, a customer who has not said — the default.
   */
  async ofUser(userId: string): Promise<CountryRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        businessMemberships: {
          where: { status: BusinessMemberStatus.ACTIVE },
          take: 1,
          select: { businessProfile: { select: { countryCode: true } } },
        },
        homeDistrict: { select: { province: { select: { countryCode: true } } } },
      },
    });
    const code = user?.businessMemberships[0]?.businessProfile.countryCode ?? user?.homeDistrict?.province.countryCode;
    return code ? this.get(code) : this.defaultCountry();
  }

  /** The country a branch is in: its shop's. */
  async ofLocation(locationId: string): Promise<CountryRow> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { business: { select: { countryCode: true } } },
    });
    if (!location) throw new NotFoundException('Location not found.');
    return this.get(location.business.countryCode);
  }

  /** The clock a country keeps. */
  async zoneOf(code: string): Promise<string> {
    return (await this.get(code)).timeZone;
  }

  /** The clock a shop keeps: its country's. */
  async zoneOfBusiness(businessId: string): Promise<string> {
    return (await this.ofBusiness(businessId)).timeZone;
  }

  /** The default country's clock — for what belongs to the whole platform, like the console's "today". */
  async platformZone(): Promise<string> {
    return (await this.defaultCountry()).timeZone;
  }

  /** What the code knows about a country, or null. */
  packOf(code: string): CountryPack | null {
    return packFor(code);
  }

  /**
   * Whether a phone number, digits only with the calling code first, is a
   * mobile number in `country`: its calling code, then exactly the number of
   * digits its mobiles have.
   */
  isMobileIn(country: CountryRow, msisdn: string): boolean {
    const digits = msisdn.replace(/\D/g, '');
    const pack = packFor(country.code);
    if (!digits.startsWith(country.callingCode)) return false;
    const national = digits.slice(country.callingCode.length);
    return pack ? national.length === pack.mobileDigits : national.length >= 6 && national.length <= 12;
  }

  /**
   * The network a number in `country` most likely belongs to (§58.1), or
   * null when its prefix is not one the country's pack knows — the customer
   * then says, rather than being guessed for.
   */
  inferNetwork(country: CountryRow, msisdn: string): MobileMoneyProvider | null {
    const digits = msisdn.replace(/\D/g, '');
    if (!digits.startsWith(country.callingCode)) return null;
    const network = packFor(country.code)?.operatorPrefixes[digits.slice(country.callingCode.length, country.callingCode.length + 2)];
    return network && country.networks.includes(network) ? network : null;
  }

  /** Logged once, so whoever reads the boot log knows which countries the platform runs in. */
  describe(rows: CountryRow[]) {
    this.logger.log(
      `Countries: ${rows.map((c) => `${c.name} (${[c.isLive ? 'live' : 'not live', c.isDefault ? 'default' : null].filter(Boolean).join(', ')})`).join('; ')}.`,
    );
  }
}
