import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppointmentStatus,
  BusinessMemberStatus,
  BusinessStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadChoiceGroups } from '../business/choice-groups';
import { resolvePicks } from '../business/service-choices';
import {
  MinuteInterval,
  WeightedInterval,
  MINUTES_PER_DAY,
  SLOT_GRID_MINUTES,
  alignUpToGrid,
  dayOfWeekUtc,
  formatCalendarDate,
  formatHhMm,
  instantToZonedParts,
  overlaps,
  parseHhMm,
  zonedWallTimeToInstant,
} from './time.util';
import { assertQuantityAllowed } from '../appointments/quantity';
import { MEMBERSHIP_SCOPE_SELECT, scopeOf, seesBranch } from '../business/branch-scope';

/**
 * Statuses that occupy a unit of a location's capacity.
 *
 * CANCELLED and NO_SHOW are excluded: both mean the appointment did not happen,
 * so the time returns to the grid. That extends §12's "CANCELLED hands its time
 * back" rule to the no-show case, for the same reason.
 *
 * PENDING_PAYMENT is INCLUDED, which the module spec did not explicitly ask
 * for. Excluding it would let unlimited customers each hold a PENDING_PAYMENT
 * booking for the same slot and then all pay, overbooking the location past its
 * capacity — the exact thing capacity exists to prevent. The cost is that an
 * abandoned booking holds a slot until it is cancelled; see DECISIONS.md, where
 * the payment-expiry sweep that resolves this is logged for the Payments
 * module. COMPLETED is included for the obvious reason that it happened.
 */
export const CAPACITY_CONSUMING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.BOOKED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

/** Why a day has no slots, when it has none. */
export type AvailabilitySource =
  | 'TEMPLATE' // weekly LocationHours, unmodified
  | 'EXCEPTION' // a date-specific exception replaced the hours
  | 'CLOSED_TEMPLATE' // weekly template says closed this weekday
  | 'CLOSED_EXCEPTION' // an exception closed this specific date
  | 'NO_TEMPLATE'; // no LocationHours row for this weekday at all

/** One start time on the day, and how many of the branch's places are free for it (§189). */
export interface AvailabilityTime {
  time: string;
  /** 0 is a time already fully booked. */
  placesLeft: number;
}

export interface AvailabilityResult {
  locationId: string;
  date: string;
  dayOfWeek: number;
  timeZone: string;
  durationMinutes: number;
  /** Concurrent appointments this location can run; slots survive until this many overlap. */
  capacity: number;
  source: AvailabilitySource;
  openTime: string | null;
  closeTime: string | null;
  reason: string | null;
  /** The start times with room for the booking asked about. */
  slots: string[];
  /**
   * Every start time the branch is open for, booked or not, with the places
   * left (§189) — so a screen can show a full time as "Booked" instead of
   * leaving a gap. Times in the past and times the shop has blocked off are
   * not here: those are not booked, they are not on offer.
   */
  times: AvailabilityTime[];
}

@Injectable()
export class AvailabilityService {
  private readonly timeZone: string;

  /**
   * The zone every slot in this module is expressed in (§103).
   *
   * Exposed because booking has to resolve a wall-clock time against the SAME
   * zone the slots were generated in. Reading the config separately there
   * would let the two drift, and a drift of one hour is a customer arriving
   * when the shop is shut.
   */
  get platformTimeZone(): string {
    return this.timeZone;
  }

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // Platform-wide, not per-location: every business is in one market for MVP.
    // When the platform crosses a timezone border this becomes a Location
    // column, and this line is the only place that has to change.
    this.timeZone = config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Juba';
  }

  /**
   * Every bookable start time at a location on a date, for a service of a
   * given length.
   *
   * Computed live from the weekly template + date exceptions + blocks +
   * appointments. Nothing about this is cached or pre-generated: the moment a
   * business edits its hours, the next call reflects it, with no backfill job
   * and no stale rows to reconcile.
   */
  async getAvailability(
    locationId: string,
    date: Date,
    durationMinutes: number,
    viewerUserId?: string | null,
    /** How many of the branch's places the booking needs at once: one per person (§189). */
    unitsNeeded = 1,
  ): Promise<AvailabilityResult> {
    if (durationMinutes <= 0 || durationMinutes > MINUTES_PER_DAY) {
      throw new BadRequestException(
        `durationMinutes must be between 1 and ${MINUTES_PER_DAY}.`,
      );
    }

    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        capacity: true,
        // A closed branch offers no slots (§89).
        isActive: true,
        // Members decide who may preview a non-approved location; status
        // gates public visibility.
        business: {
          select: {
            status: true,
            members: {
              where: { status: BusinessMemberStatus.ACTIVE },
              select: { userId: true, ...MEMBERSHIP_SCOPE_SELECT },
            },
          },
        },
      },
    });
    if (!location) {
      throw new NotFoundException('Location not found.');
    }

    // ---- Visibility gate ----
    //
    // Active members see their own location's availability at any status,
    // because a PENDING business needs to preview that its hours produce
    // sensible slots before an admin ever looks at it. Everyone else —
    // anonymous callers, customers, and other businesses alike — only sees
    // APPROVED locations.
    //
    // 404 rather than 403, matching the ownership checks elsewhere: the public
    // should not be able to tell an unapproved location apart from one that
    // does not exist.
    // Any ACTIVE member may preview, not just the owner: a manager setting up
    // the schedule needs the same view of it that the owner has.
    // A member who looks after this branch (§277).
    const isMember =
      Boolean(viewerUserId) &&
      location.business.members.some(
        (member) => member.userId === viewerUserId && seesBranch(scopeOf(member), locationId),
      );

    if (!isMember && location.business.status !== BusinessStatus.APPROVED) {
      throw new NotFoundException('Location not found.');
    }

    // A closed branch offers nothing to the public (§89). Members still see it,
    // on the same reasoning as the status gate above: an owner reopening a
    // branch needs to check its hours still produce sensible slots first.
    if (!isMember && !location.isActive) {
      throw new NotFoundException('Location not found.');
    }

    const dayOfWeek = dayOfWeekUtc(date);
    const base: Omit<
      AvailabilityResult,
      'source' | 'openTime' | 'closeTime' | 'reason' | 'slots' | 'times'
    > = {
      locationId,
      date: formatCalendarDate(date),
      dayOfWeek,
      timeZone: this.timeZone,
      durationMinutes,
      capacity: location.capacity,
    };
    const closed = (source: AvailabilitySource, reason: string | null = null) => ({
      ...base,
      source,
      openTime: null,
      closeTime: null,
      reason,
      slots: [],
      times: [],
    });

    // Both are read up front, in one round trip. The exception decides whether
    // the template is consulted at all, but fetching them in parallel is
    // cheaper than discovering that sequentially.
    const [exception, template] = await Promise.all([
      this.prisma.locationScheduleException.findUnique({
        where: { locationId_date: { locationId, date } },
      }),
      this.prisma.locationHours.findUnique({
        where: { locationId_dayOfWeek: { locationId, dayOfWeek } },
      }),
    ]);

    let openMinutes: number | null = null;
    let closeMinutes: number | null = null;
    let source: AvailabilitySource;
    let reason: string | null = exception?.reason ?? null;

    // ---- Step 1: a date-specific exception outranks the weekly template ----
    //
    // Checked FIRST, including against a template that calls this weekday
    // closed. That is the whole point of an exception: "we are normally shut on
    // Sundays, but we are opening 10:00-14:00 this one" has to be expressible.
    // Consulting the template first would make that override unreachable.
    if (exception?.isClosed) {
      return closed('CLOSED_EXCEPTION', exception.reason);
    }

    if (exception?.customOpenTime && exception.customCloseTime) {
      openMinutes = parseHhMm(exception.customOpenTime);
      closeMinutes = parseHhMm(exception.customCloseTime);
      source = 'EXCEPTION';
    } else {
      // ---- Step 2: no exception governs this date, so the template rules ----
      //
      // Reached when there is no exception at all, or when one exists carrying
      // only a reason. Write-side validation rejects that second shape, so it
      // is defensive: such a row annotates the date without changing its hours.

      // A missing row is closed, not an error: a location that configured only
      // Mon-Fri is simply shut at the weekend.
      if (!template) return closed('NO_TEMPLATE', reason);
      if (template.isClosed) return closed('CLOSED_TEMPLATE', reason);

      openMinutes = parseHhMm(template.openTime);
      closeMinutes = parseHhMm(template.closeTime);
      source = 'TEMPLATE';
    }

    // Defensive: these strings are validated on write, so a failure here means
    // data was edited outside the API rather than a bad request.
    if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
      return closed(source, reason);
    }

    // ---- Steps 4 & 5: gather everything that removes time from the day ----
    const unavailability = await this.collectUnavailability(locationId, date);

    // ---- Steps 3 & 6: walk the grid, keeping only slots that fully fit ----
    const times = this.buildSlots(
      openMinutes,
      closeMinutes,
      durationMinutes,
      unavailability,
      location.capacity,
      date,
    );

    return {
      ...base,
      source,
      openTime: formatHhMm(openMinutes),
      closeTime: formatHhMm(closeMinutes),
      reason,
      slots: times
        .filter((slot) => slot.placesLeft >= unitsNeeded)
        .map((slot) => formatHhMm(slot.start)),
      times: times.map((slot) => ({ time: formatHhMm(slot.start), placesLeft: slot.placesLeft })),
    };
  }

  /**
   * The same answer, asked the way a customer asks it: "when can THREE of us
   * have this service?" (§136, §189).
   *
   * Three people take three of the branch's places for the service's own
   * length, so the times offered are the ones with three places still free.
   * Worked out HERE from the service and the branch rather than sent by the
   * client, so the times offered are the times booking accepts.
   */
  async getAvailabilityForService(
    locationId: string,
    date: Date,
    serviceId: string,
    quantity: number,
    viewerUserId?: string | null,
    optionIds: readonly string[] = [],
  ): Promise<AvailabilityResult> {
    const [service, location] = await Promise.all([
      this.prisma.service.findUnique({
        where: { id: serviceId },
        select: { businessId: true, durationMinutes: true },
      }),
      this.prisma.location.findUnique({
        where: { id: locationId },
        select: { businessId: true, capacity: true },
      }),
    ]);
    // One message for every way the pair can be wrong: a service id from
    // another business is, to this caller, a service that does not exist.
    if (!service || !location || service.businessId !== location.businessId) {
      throw new NotFoundException('Service not found.');
    }

    assertQuantityAllowed(quantity, location.capacity);

    // The answers' extra minutes (§300.4), worked out here rather than sent,
    // by the rules the booking uses — so a time offered is a time that books.
    // Partial: required questions may not all be answered yet.
    const extra =
      optionIds.length === 0
        ? 0
        : resolvePicks(await loadChoiceGroups(this.prisma, serviceId), optionIds, { partial: true }).minutes;

    return this.getAvailability(
      locationId,
      date,
      service.durationMinutes + extra,
      viewerUserId,
      quantity,
    );
  }

  /**
   * The bookable start times for the local day containing `startInstant`, plus
   * that instant rendered as a local "HH:mm".
   *
   * Exists so the booking endpoint can validate a requested slot against the
   * *same* computation the public availability endpoint serves, instead of
   * reimplementing opening hours, exceptions, blocks, capacity and the
   * fits-before-closing rule and letting the two drift apart.
   *
   * Note it is called with no viewer, so the APPROVED-only visibility rule
   * applies: a location whose business is not approved is not bookable, and
   * reports itself as not found. The past-slot filter applies too, so a start
   * time that has already elapsed is simply not in the returned list.
   */
  async getBookableStartTimes(
    locationId: string,
    startInstant: Date,
    durationMinutes: number,
    unitsNeeded = 1,
  ): Promise<{ slots: string[]; localStart: string; date: string }> {
    const { date, minutesSinceMidnight } = instantToZonedParts(
      startInstant,
      this.timeZone,
    );

    const availability = await this.getAvailability(
      locationId,
      date,
      durationMinutes,
      undefined,
      unitsNeeded,
    );

    return {
      slots: availability.slots,
      localStart: formatHhMm(minutesSinceMidnight),
      date: availability.date,
    };
  }

  /**
   * The two kinds of unavailability, kept deliberately separate.
   *
   * - **closures** — manual time blocks. These take the WHOLE location out of
   *   service for a period, regardless of capacity: "the owner is away
   *   2pm-4pm" does not mean one of four chairs is busy, it means the place is
   *   shut. One closure removes the time no matter how large capacity is.
   * - **appointments** — each consumes its own `capacityUnits`: one place per
   *   person (§189). A slot survives while the places taken during it leave
   *   room for the booking being asked about.
   *
   * Both are reduced to minutes since local midnight before being compared.
   */
  private async collectUnavailability(
    locationId: string,
    date: Date,
  ): Promise<{ closures: MinuteInterval[]; appointments: WeightedInterval[] }> {
    const dayStart = zonedWallTimeToInstant(date, 0, this.timeZone);
    const dayEnd = zonedWallTimeToInstant(date, MINUTES_PER_DAY, this.timeZone);

    const [blocks, appointments] = await Promise.all([
      this.prisma.locationTimeBlock.findMany({ where: { locationId, date } }),
      this.prisma.appointment.findMany({
        where: {
          locationId,
          status: { in: CAPACITY_CONSUMING_STATUSES },
          // Overlap, not containment: an appointment starting at 23:30 the
          // previous day and running past midnight still blocks this morning.
          startTime: { lt: dayEnd },
          endTime: { gt: dayStart },
        },
        select: { startTime: true, endTime: true, capacityUnits: true },
      }),
    ]);

    const closures: MinuteInterval[] = [];
    for (const block of blocks) {
      const start = parseHhMm(block.startTime);
      const end = parseHhMm(block.endTime);
      if (start !== null && end !== null && end > start) {
        closures.push({ start, end });
      }
    }

    const booked: WeightedInterval[] = [];
    for (const appointment of appointments) {
      // Offset from local midnight, then clamped to the day. An appointment
      // spilling over either edge occupies only the part on this date.
      const start = (appointment.startTime.getTime() - dayStart.getTime()) / 60_000;
      const end = (appointment.endTime.getTime() - dayStart.getTime()) / 60_000;
      booked.push({
        start: Math.max(0, start),
        end: Math.min(MINUTES_PER_DAY, end),
        units: appointment.capacityUnits,
      });
    }

    return {
      closures: closures.filter((i) => i.end > i.start),
      appointments: booked.filter((i) => i.end > i.start),
    };
  }

  /**
   * Every start time on the grid that the branch is open for, with the places
   * still free across the whole of it (§189).
   */
  private buildSlots(
    openMinutes: number,
    closeMinutes: number,
    durationMinutes: number,
    unavailability: { closures: MinuteInterval[]; appointments: WeightedInterval[] },
    capacity: number,
    date: Date,
  ): Array<{ start: number; placesLeft: number }> {
    // A slot may only start in the past-cutoff future. Computed once per call
    // so every slot is judged against the same instant.
    const nowMinutes = this.minutesSinceLocalMidnight(date);

    const slots: Array<{ start: number; placesLeft: number }> = [];

    // Opening at 08:10 means the first bookable start is 08:15, not 08:10 —
    // the grid is absolute, not relative to opening time.
    for (
      let start = alignUpToGrid(openMinutes);
      // The fit rule: the service must END by closing time. With a 45-minute
      // service closing at 17:00, the last start is 16:15 — 16:30 would run
      // over, so it is never offered.
      start + durationMinutes <= closeMinutes;
      start += SLOT_GRID_MINUTES
    ) {
      if (nowMinutes !== null && start < nowMinutes) {
        continue; // already in the past for this location
      }

      const candidate: MinuteInterval = { start, end: start + durationMinutes };

      // A closure shuts the location outright — capacity is irrelevant.
      if (unavailability.closures.some((interval) => overlaps(candidate, interval))) {
        continue;
      }

      // Each appointment takes its own number of places — one per person
      // (§189). What is left is the branch's places minus the BUSIEST moment
      // inside the window, not minus everything that touches it: a booking
      // ending at 10:00 and another starting at 10:00 never share a chair.
      const taken = busiest(
        candidate,
        unavailability.appointments.filter((interval) => overlaps(candidate, interval)),
      );
      slots.push({ start, placesLeft: Math.max(0, capacity - taken) });
    }

    return slots;
  }

  /**
   * Where "now" falls on this calendar date, in local minutes — or null if the
   * date is not today (past dates yield no slots via an empty grid anyway,
   * future dates are entirely open).
   */
  private minutesSinceLocalMidnight(date: Date): number | null {
    const dayStart = zonedWallTimeToInstant(date, 0, this.timeZone);
    const elapsed = (Date.now() - dayStart.getTime()) / 60_000;

    if (elapsed < 0) return null; // date is in the future
    if (elapsed >= MINUTES_PER_DAY) return MINUTES_PER_DAY; // date has fully passed
    return elapsed;
  }
}

/**
 * The most places in use at any one moment inside `window` (§189).
 *
 * Places in use only change where a booking starts, so it is enough to look
 * at the window's own start and at every booking that starts inside it.
 */
function busiest(window: MinuteInterval, booked: WeightedInterval[]): number {
  const moments = [
    window.start,
    ...booked.map((b) => b.start).filter((t) => t > window.start && t < window.end),
  ];
  let most = 0;
  for (const moment of moments) {
    const inUse = booked
      .filter((b) => b.start <= moment && moment < b.end)
      .reduce((sum, b) => sum + b.units, 0);
    most = Math.max(most, inUse);
  }
  return most;
}
