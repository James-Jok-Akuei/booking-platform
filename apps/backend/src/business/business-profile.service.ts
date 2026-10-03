import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// One select, shared with the DTO describing its result (§128.5).
import { PROFILE_SELECT } from './dto/business-response.dto';
import { StorageService } from '../storage/storage.service';
import { UpdateBusinessProfileDto } from './dto/update-profile.dto';

@Injectable()
export class BusinessProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Stores a logo or cover image and records it on the profile (§88).
   *
   * The DTO has always accepted `logoUrl` and `coverImageUrl` as plain strings,
   * which quietly assumed the business already had the image hosted somewhere.
   * They do not — that is the whole reason this platform exists for them. So
   * the bytes come here, the same way a gallery photo does, and the profile
   * records the URL storage hands back.
   *
   * The previous image is removed after the row is updated, never before: a
   * failed write must not leave a profile pointing at a file that is gone.
   */
  async setImage(
    businessId: string,
    kind: 'logo' | 'cover',
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded.');

    const existing = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: { logoUrl: true, coverImageUrl: true },
    });
    if (!existing) throw new NotFoundException('Business not found.');

    const url = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `businesses/${businessId}`,
    );

    const updated = await this.prisma.businessProfile.update({
      where: { id: businessId },
      data: kind === 'logo' ? { logoUrl: url } : { coverImageUrl: url },
      select: PROFILE_SELECT,
    });

    const previous = kind === 'logo' ? existing.logoUrl : existing.coverImageUrl;
    if (previous && previous !== url) {
      // Best-effort, and deliberately not awaited into the response path: an
      // orphaned object is a cleanup problem, a failed request is the user's.
      void this.storage.remove(previous);
    }

    return updated;
  }

  // Takes a businessId now, not a userId: the caller's business is resolved
  // once by BusinessRolesGuard, and several people may share it.
  async findOwn(businessId: string) {
    return this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: PROFILE_SELECT,
    });
  }

  async update(businessId: string, dto: UpdateBusinessProfileDto) {
    const current = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, categoryId: true, status: true },
    });

    // Resolve the category/subcategory pair against whatever is already stored,
    // so sending only `subcategoryId` still gets validated against the existing
    // category rather than silently skipping the check.
    const categoryId = dto.categoryId ?? current.categoryId ?? null;
    const subcategoryId = dto.subcategoryId ?? null;

    if (dto.categoryId) {
      const exists = await this.prisma.category.count({ where: { id: dto.categoryId } });
      if (!exists) {
        throw new BadRequestException('Unknown category.');
      }
    }

    if (dto.subcategoryId) {
      if (!categoryId) {
        throw new BadRequestException(
          'Select a category before selecting a subcategory.',
        );
      }
      // The subcategory must belong to the category being set — otherwise a
      // "Hair Salon" business could end up filed under Automotive.
      const belongs = await this.prisma.subcategory.count({
        where: { id: dto.subcategoryId, categoryId },
      });
      if (!belongs) {
        throw new BadRequestException(
          'That subcategory does not belong to the selected category.',
        );
      }
    }

    // Changing category without naming a subcategory clears the old one, which
    // would otherwise be left dangling under the wrong parent.
    const clearSubcategory =
      Boolean(dto.categoryId) &&
      dto.categoryId !== current.categoryId &&
      !dto.subcategoryId;

    return this.prisma.businessProfile.update({
      where: { id: current.id },
      data: {
        name: dto.name,
        description: dto.description,
        phone: dto.phone,
        logoUrl: dto.logoUrl,
        coverImageUrl: dto.coverImageUrl,
        categoryId: dto.categoryId,
        subcategoryId: clearSubcategory ? null : (subcategoryId ?? undefined),
      },
      select: PROFILE_SELECT,
    });
  }
}
