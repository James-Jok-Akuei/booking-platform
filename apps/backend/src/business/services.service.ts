import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { BusinessAccessService } from './business-access.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

/**
 * Services belong to the *business*, not to a location.
 *
 * A salon with three branches offers the same haircut at all three; duplicating
 * the row per location would mean editing the price three times and would make
 * "which of these three haircuts did the customer book?" a meaningless
 * question. Per-location availability is a scheduling concern and belongs to
 * the availability module, not to the service catalogue.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * A service's deposit must be at least the platform's fee.
   *
   * Both percentages apply to the same base — the service price — so this floor
   * is exactly what guarantees the fee never exceeds the deposit it is taken
   * from, i.e. that businessAmountCents can never be negative. At the floor the
   * business receives nothing from the deposit, which is legal but worth the
   * business understanding.
   *
   * Read LIVE on every write, never cached into a constant: an admin can change
   * the fee at runtime, and a service saved yesterday must be validated against
   * today's rule.
   */
  private async assertDepositCoversPlatformFee(depositPercentage?: number) {
    if (depositPercentage === undefined) return;

    const fee = await this.settings.getPlatformFeePercentage();
    if (new Prisma.Decimal(depositPercentage).lessThan(fee)) {
      throw new BadRequestException(
        `Deposit percentage must be at least ${fee.toFixed(2)}% (current platform fee).`,
      );
    }
  }

  async create(userId: string, dto: CreateServiceDto) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.assertDepositCoversPlatformFee(dto.depositPercentage);

    return this.prisma.service.create({ data: { businessId, ...dto } });
  }

  /** Returns inactive services too — this is the owner's own catalogue view. */
  async findAll(userId: string) {
    const businessId = await this.access.requireBusinessId(userId);

    return this.prisma.service.findMany({
      where: { businessId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async update(userId: string, serviceId: string, dto: UpdateServiceDto) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.requireOwned(businessId, serviceId);
    await this.assertDepositCoversPlatformFee(dto.depositPercentage);

    return this.prisma.service.update({ where: { id: serviceId }, data: dto });
  }

  /**
   * Soft delete — flips isActive to false, never removes the row.
   *
   * Appointments will reference serviceId, and a completed booking has to keep
   * resolving to the service name and price it was made at long after the
   * business stops offering it. A hard delete would either orphan those records
   * or cascade away booking history.
   */
  async deactivate(userId: string, serviceId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.requireOwned(businessId, serviceId);

    const service = await this.prisma.service.update({
      where: { id: serviceId },
      data: { isActive: false },
    });

    return {
      message:
        'Service deactivated. It is hidden from customers but kept so past appointments still resolve.',
      service,
    };
  }

  private async requireOwned(businessId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
      select: { id: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }
}
