import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessAccessService } from './business-access.service';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { SERVICE_DRAFT_SELECT } from './dto/business-write-response.dto';

// One select, shared with the DTO that describes its result (§128.5).
const SELECT = SERVICE_DRAFT_SELECT;

/**
 * Services somebody started and has not finished (§123).
 *
 * Nothing here validates. A draft exists BECAUSE it is incomplete, so applying
 * the service rules to it would defeat the point — they apply when it is turned
 * into a real service, which is a separate act through the existing endpoint.
 */
@Injectable()
export class ServiceDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BusinessAccessService,
  ) {}

  async list(userId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    return this.prisma.serviceDraft.findMany({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
      select: SELECT,
    });
  }

  async create(userId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    return this.prisma.serviceDraft.create({
      data: { businessId, createdById: userId },
      select: SELECT,
    });
  }

  /**
   * Saves whatever has been typed so far.
   *
   * Scoped by business in the `where`, so another shop's draft id simply matches
   * no row — the same rule the rest of this codebase uses rather than loading a
   * row and then checking who owns it.
   */
  async update(
    userId: string,
    id: string,
    data: {
      name?: string | null;
      description?: string | null;
      durationMinutes?: number | null;
      depositPercentage?: number | null;
      offers?: Array<{ locationId: string; priceMinor: number }>;
    },
  ) {
    const businessId = await this.access.requireBusinessId(userId);
    const { count } = await this.prisma.serviceDraft.updateMany({
      where: { id, businessId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.durationMinutes !== undefined
          ? { durationMinutes: data.durationMinutes }
          : {}),
        ...(data.depositPercentage !== undefined
          ? { depositPercentage: data.depositPercentage }
          : {}),
        ...(data.offers !== undefined
          ? { offers: data.offers as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    if (count === 0) throw new NotFoundException('Draft not found.');
    return this.prisma.serviceDraft.findFirstOrThrow({
      where: { id, businessId },
      select: SELECT,
    });
  }

  /**
   * Throws a draft away.
   *
   * A real delete, unlike almost everything else here (§75, §101). A draft is
   * nobody's record of anything: no customer saw it, no money moved because of
   * it, and keeping an abandoned half-sentence forever would turn the drafts
   * list into the thing it exists to prevent.
   */
  async discard(userId: string, id: string): Promise<ActionMessageDto> {
    const businessId = await this.access.requireBusinessId(userId);
    const { count } = await this.prisma.serviceDraft.deleteMany({
      where: { id, businessId },
    });
    if (count === 0) throw new NotFoundException('Draft not found.');
    return { message: 'Draft discarded.' };
  }
}
