import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { DiscoveryService } from '../discovery/discovery.service';
import { DiscoverySort } from '../discovery/dto/discover-locations.dto';
import { DiscoveredServiceDto } from '../discovery/dto/discovery-response.dto';
import { MailService } from '../mail/mail.service';
import { RoutingService } from '../routing/routing.service';
import { minorUnitExponent } from '../payments/currency';
import { PrismaService } from '../prisma/prisma.service';
import { OffersPreferenceDto, UpdateOffersPreferenceDto } from './dto/offers.dto';

/** Nobody hears from us more often than this, whatever the schedule does. */
export const OFFERS_MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000;
/** How many services one email shows. */
export const OFFERS_PER_EMAIL = 5;
/** Fewer than this in the district and the email looks at the whole province. */
const WIDEN_BELOW = 3;

/** Searched first around an exact spot, then wider (§169). */
const SPOT_RADII_KM = [10, 25];

const PREFERENCE_SELECT = {
  offersOptInAt: true,
  homeLatitude: true,
  homeLongitude: true,
  homeLabel: true,
  homeDistrict: {
    select: { id: true, name: true, province: { select: { name: true } } },
  },
} as const;

/**
 * Emails about services near a customer (§140).
 *
 * Three rules hold everything here:
 *
 * 1. **Nobody is sent anything they did not ask for.** `offersOptInAt` is null
 *    for every account until its owner turns this on, and the weekly job reads
 *    only rows where it is set.
 * 2. **"Near" is a district the customer named**, not a position taken from a
 *    phone. It is enough to choose the right shops and it is not a record of
 *    where somebody was.
 * 3. **Leaving is one tap and needs no password.** Every email carries a link
 *    with a random token that turns it off.
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly routing: RoutingService,
  ) {}

  async preference(userId: string): Promise<OffersPreferenceDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PREFERENCE_SELECT,
    });
    if (!user) throw new NotFoundException('Account not found.');
    return this.toDto(user);
  }

  async update(userId: string, dto: UpdateOffersPreferenceDto): Promise<OffersPreferenceDto> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { homeDistrictId: true, offersOptInAt: true, homeLatitude: true },
    });
    if (!current) throw new NotFoundException('Account not found.');

    if (dto.districtId) {
      // A retired district (§105.2) has no shops to write about.
      const district = await this.prisma.district.findFirst({
        where: { id: dto.districtId, isLive: true },
        select: { id: true },
      });
      if (!district) throw new BadRequestException('Choose a district from the list.');
    }

    const districtId = dto.districtId === undefined ? current.homeDistrictId : dto.districtId;
    const hasSpot = dto.spot === undefined ? current.homeLatitude !== null : dto.spot !== null;
    if (dto.optedIn && !districtId && !hasSpot) {
      throw new BadRequestException(
        'Choose your district or use your exact location first, so we know what is near you.',
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        homeDistrictId: districtId,
        // The exact spot (§169): set, forgotten with null, kept when left out.
        ...(dto.spot === undefined
          ? {}
          : dto.spot === null
            ? { homeLatitude: null, homeLongitude: null, homeLabel: null }
            : {
                homeLatitude: dto.spot.latitude,
                homeLongitude: dto.spot.longitude,
                homeLabel: dto.spot.label?.trim() || null,
              }),
        ...(dto.optedIn
          ? // Agreeing again does not move the date they first agreed. A fresh
            // token each time they come back, so an old email's link cannot
            // turn off a choice made after it was sent... and cannot be used
            // to probe whether an address is subscribed.
            current.offersOptInAt
            ? {}
            : { offersOptInAt: new Date(), offersToken: randomBytes(24).toString('base64url') }
          : { offersOptInAt: null, offersToken: null }),
      },
      select: PREFERENCE_SELECT,
    });
    return this.toDto(user);
  }

  /**
   * Turns the emails off from a link in one of them.
   *
   * Answers the same way whether or not the token matched anything: the page
   * says "you will not get these", which is true either way, and an unknown
   * token learns nothing about who is subscribed.
   */
  async unsubscribe(token: string): Promise<void> {
    if (!token) return;
    await this.prisma.user.updateMany({
      where: { offersToken: token },
      data: { offersOptInAt: null, offersToken: null },
    });
  }

  /**
   * Sends this week's email to everyone who asked for one and is due.
   *
   * Worked out once per DISTRICT, not once per person: everyone in Gasabo gets
   * the same five services, so the search runs once for all of them.
   *
   * A district with nothing to show sends nothing — and does not mark anyone as
   * sent, so the week a shop opens there, they hear about it.
   */
  async sendDue(now = new Date()): Promise<{ sent: number; skipped: number }> {
    const due = await this.prisma.user.findMany({
      where: {
        role: UserRole.CUSTOMER,
        closedAt: null,
        offersOptInAt: { not: null },
        offersToken: { not: null },
        // A district, or an exact spot (§169).
        OR: [{ homeDistrictId: { not: null } }, { homeLatitude: { not: null } }],
        AND: [
          {
            OR: [
              { offersLastSentAt: null },
              { offersLastSentAt: { lt: new Date(now.getTime() - OFFERS_MIN_GAP_MS) } },
            ],
          },
        ],
      },
      select: {
        id: true,
        email: true,
        offersToken: true,
        homeLatitude: true,
        homeLongitude: true,
        homeLabel: true,
        homeDistrict: {
          select: { id: true, name: true, provinceId: true, province: { select: { name: true } } },
        },
      },
    });

    const picks = new Map<string, Pick>();
    let sent = 0;
    let skipped = 0;

    for (const user of due) {
      // An exact spot is the customer's own, so its pick is too; a district
      // pick is shared by everyone in it and worked out once (§140.4).
      let pick: Pick;
      if (user.homeLatitude !== null && user.homeLongitude !== null) {
        pick = await this.pickAround(
          { lat: user.homeLatitude, lng: user.homeLongitude },
          user.homeLabel,
          user.homeDistrict,
        );
      } else {
        const district = user.homeDistrict!;
        if (!picks.has(district.id)) picks.set(district.id, await this.pickFor(district));
        pick = picks.get(district.id)!;
      }
      if (pick.services.length === 0) {
        skipped += 1;
        continue;
      }

      try {
        await this.mail.sendOffersDigest(user.email, {
          place: pick.place,
          nearSpot: Boolean(pick.away),
          unsubscribeUrl: this.unsubscribeUrl(user.offersToken!),
          services: pick.services.map((s, i) => ({
            away: pick.away?.[i] ?? null,
            name: s.name,
            shop: s.business.name ?? s.location.name,
            where: s.location.district?.name ?? null,
            price: formatMoney(s.priceMinor, s.currency),
            sale: s.discount
              ? { was: formatMoney(s.discount.listPriceMinor, s.currency), percent: s.discount.percent }
              : null,
            minutes: s.durationMinutes,
            imageUrl: s.imageUrl ?? s.business.coverImageUrl,
            rating: s.location.ratingCount > 0 ? s.location.ratingAvg : null,
          })),
        });
        // Marked only AFTER the send, so a failure is retried next run rather
        // than counted as a week's email that nobody received.
        await this.prisma.user.update({
          where: { id: user.id },
          data: { offersLastSentAt: now },
        });
        sent += 1;
      } catch (error) {
        skipped += 1;
        this.logger.error(`Offers email to user ${user.id} failed.`, error as Error);
      }
    }

    if (due.length > 0) {
      this.logger.log(`Offers near you: ${sent} sent, ${skipped} skipped, of ${due.length} due.`);
    }
    return { sent, skipped };
  }

  /**
   * The most popular services near an exact spot (§169): within ten
   * kilometres, then twenty-five, and the district's pick if even that is
   * thin. Distances are measured by ROAD from the spot, in one request, and
   * said that way in the email.
   */
  private async pickAround(
    spot: { lat: number; lng: number },
    label: string | null,
    district: { id: string; name: string; provinceId: string; province: { name: string } } | null,
  ): Promise<Pick> {
    for (const radiusKm of SPOT_RADII_KM) {
      const found = await this.discovery.searchServices({
        lat: spot.lat,
        lng: spot.lng,
        radiusKm,
        sort: DiscoverySort.POPULAR,
        limit: OFFERS_PER_EMAIL,
        offset: 0,
      });
      if (found.services.length >= WIDEN_BELOW) {
        const shops = await this.prisma.location.findMany({
          where: { id: { in: found.services.map((s) => s.location.id) } },
          select: { id: true, latitude: true, longitude: true },
        });
        const where = new Map(shops.map((l) => [l.id, l]));
        const targets = found.services.map((s) => {
          const l = where.get(s.location.id);
          return { lat: l?.latitude ?? spot.lat, lng: l?.longitude ?? spot.lng };
        });
        const measured = await this.routing.fromPoint(spot, targets);
        return {
          place: label ?? 'you',
          services: found.services,
          away: measured.map((m) =>
            m.by === 'road' ? `${formatKm(m.distanceKm)} by road` : `${formatKm(m.distanceKm)} away`,
          ),
        };
      }
    }
    return district ? this.pickFor(district) : { place: label ?? 'you', services: [] };
  }

  /**
   * The most popular services in a district — through the public search, so an
   * email can only ever show what a customer could find and book (§135.2).
   * With too few there, the whole province, and the email says so.
   */
  private async pickFor(district: {
    id: string;
    name: string;
    provinceId: string;
    province: { name: string };
  }): Promise<{ place: string; services: DiscoveredServiceDto[] }> {
    const inDistrict = await this.discovery.searchServices({
      districtId: district.id,
      sort: DiscoverySort.POPULAR,
      limit: OFFERS_PER_EMAIL,
      offset: 0,
    });
    if (inDistrict.services.length >= WIDEN_BELOW) {
      return { place: district.name, services: inDistrict.services };
    }
    const inProvince = await this.discovery.searchServices({
      provinceId: district.provinceId,
      sort: DiscoverySort.POPULAR,
      limit: OFFERS_PER_EMAIL,
      offset: 0,
    });
    return {
      place: district.province.name.replace(/^City of /, ''),
      services: inProvince.services,
    };
  }

  private unsubscribeUrl(token: string): string {
    const base = (this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    return `${base}/offers/unsubscribe/${token}`;
  }

  private toDto(user: {
    offersOptInAt: Date | null;
    homeLatitude: number | null;
    homeLongitude: number | null;
    homeLabel: string | null;
    homeDistrict: { id: string; name: string; province: { name: string } } | null;
  }): OffersPreferenceDto {
    return {
      optedIn: user.offersOptInAt !== null,
      optedInAt: user.offersOptInAt?.toISOString() ?? null,
      district: user.homeDistrict
        ? {
            id: user.homeDistrict.id,
            name: user.homeDistrict.name,
            provinceName: user.homeDistrict.province.name,
          }
        : null,
      spot:
        user.homeLatitude !== null && user.homeLongitude !== null
          ? { latitude: user.homeLatitude, longitude: user.homeLongitude, label: user.homeLabel }
          : null,
    };
  }
}

type Pick = { place: string; services: DiscoveredServiceDto[]; away?: string[] };

/** "600 m", "3.4 km", "12 km". */
const formatKm = (km: number) =>
  km < 1 ? `${Math.max(50, Math.round(km * 20) * 50)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;

/** "RWF 7,000" — minor units to what a person reads, by the currency's own exponent. */
export function formatMoney(minor: number, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const major = minor / 10 ** exponent;
  return `${currency} ${major.toLocaleString('en-US', {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  })}`;
}
