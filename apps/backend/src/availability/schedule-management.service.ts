import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessAccessService } from '../business/business-access.service';
import { CreateScheduleExceptionDto } from './dto/create-schedule-exception.dto';
import { CreateTimeBlockDto } from './dto/create-time-block.dto';
import { formatCalendarDate, parseCalendarDate, parseHhMm } from './time.util';

/**
 * Write side of availability: the date-specific exceptions and manual blocks
 * that override the weekly template.
 *
 * Ownership follows the same structural rule as the rest of the business
 * module — resolve the caller's own businessId, prove the location is theirs,
 * and only then touch anything. See BusinessAccessService.
 */
@Injectable()
export class ScheduleManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
  ) {}

  // ---------- Schedule exceptions ----------

  /**
   * Creates or replaces the exception for a date.
   *
   * Upsert rather than reject-if-exists: the model is "one exception per date"
   * (enforced by a unique constraint), and the business's intent when setting
   * one twice is plainly to change it. Making them delete the old row first
   * would be ceremony with a 409 in the middle, and would leave the frontend
   * doing a read-modify-write for what is conceptually one action.
   */
  async createException(
    userId: string,
    locationId: string,
    dto: CreateScheduleExceptionDto,
  ) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const date = this.parseDate(dto.date);
    const isClosed = dto.isClosed ?? false;
    const hasOpen = Boolean(dto.customOpenTime);
    const hasClose = Boolean(dto.customCloseTime);

    if (isClosed && (hasOpen || hasClose)) {
      throw new BadRequestException(
        'A closed day cannot also have custom opening hours. Set isClosed, or set customOpenTime and customCloseTime — not both.',
      );
    }

    if (!isClosed) {
      if (hasOpen !== hasClose) {
        throw new BadRequestException(
          'customOpenTime and customCloseTime must be provided together.',
        );
      }
      if (!hasOpen) {
        // Otherwise the row says nothing: not closed, and no hours that differ
        // from the template. Storing it would make the exception table lie
        // about which dates are actually exceptional.
        throw new BadRequestException(
          'An exception must either close the day (isClosed: true) or set customOpenTime and customCloseTime.',
        );
      }

      const open = parseHhMm(dto.customOpenTime!)!;
      const close = parseHhMm(dto.customCloseTime!)!;
      if (close <= open) {
        throw new BadRequestException(
          'customCloseTime must be later than customOpenTime. Overnight hours are not supported yet.',
        );
      }
    }

    const data = {
      isClosed,
      // Explicit null, not undefined: flipping a custom-hours exception to
      // closed must actively clear the old times, not leave them behind.
      customOpenTime: isClosed ? null : (dto.customOpenTime ?? null),
      customCloseTime: isClosed ? null : (dto.customCloseTime ?? null),
      reason: dto.reason ?? null,
    };

    const exception = await this.prisma.locationScheduleException.upsert({
      where: { locationId_date: { locationId, date } },
      create: { locationId, date, ...data },
      update: data,
    });

    return this.serializeException(exception);
  }

  async listExceptions(userId: string, locationId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const exceptions = await this.prisma.locationScheduleException.findMany({
      where: { locationId },
      orderBy: { date: 'asc' },
    });

    return exceptions.map((exception) => this.serializeException(exception));
  }

  async deleteException(userId: string, locationId: string, exceptionId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    // Scoped by locationId as well as id, so an exception id belonging to
    // another location can never be deleted through this route.
    const existing = await this.prisma.locationScheduleException.findFirst({
      where: { id: exceptionId, locationId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Schedule exception not found.');
    }

    await this.prisma.locationScheduleException.delete({ where: { id: exceptionId } });
    return { message: 'Schedule exception removed. This date follows the weekly template again.' };
  }

  // ---------- Time blocks ----------

  async createTimeBlock(userId: string, locationId: string, dto: CreateTimeBlockDto) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const date = this.parseDate(dto.date);
    const start = parseHhMm(dto.startTime)!;
    const end = parseHhMm(dto.endTime)!;

    if (end <= start) {
      throw new BadRequestException('endTime must be later than startTime.');
    }

    // Overlapping blocks are allowed on purpose — two overlapping blocks remove
    // the same time as one merged block would, so rejecting them would be
    // pedantry that costs the business a retry for no benefit.
    const block = await this.prisma.locationTimeBlock.create({
      data: {
        locationId,
        date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        reason: dto.reason ?? null,
      },
    });

    return this.serializeBlock(block);
  }

  async listTimeBlocks(userId: string, locationId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const blocks = await this.prisma.locationTimeBlock.findMany({
      where: { locationId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    return blocks.map((block) => this.serializeBlock(block));
  }

  async deleteTimeBlock(userId: string, locationId: string, blockId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const existing = await this.prisma.locationTimeBlock.findFirst({
      where: { id: blockId, locationId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Time block not found.');
    }

    await this.prisma.locationTimeBlock.delete({ where: { id: blockId } });
    return { message: 'Time block removed.' };
  }

  // ---------- Shared ----------

  private parseDate(value: string): Date {
    const date = parseCalendarDate(value);
    if (!date) {
      throw new BadRequestException(`"${value}" is not a valid calendar date.`);
    }
    return date;
  }

  // Prisma hands back a @db.Date as a Date at UTC midnight; the API speaks
  // "YYYY-MM-DD" so clients never see a spurious time or offset.
  private serializeException<T extends { date: Date }>(exception: T) {
    return { ...exception, date: formatCalendarDate(exception.date) };
  }

  private serializeBlock<T extends { date: Date }>(block: T) {
    return { ...block, date: formatCalendarDate(block.date) };
  }
}
