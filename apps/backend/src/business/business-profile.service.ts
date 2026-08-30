import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBusinessProfileDto } from './dto/update-profile.dto';

const PROFILE_SELECT = {
  id: true,
  name: true,
  description: true,
  phone: true,
  logoUrl: true,
  coverImageUrl: true,
  status: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, icon: true } },
  subcategory: { select: { id: true, name: true } },
} as const;

@Injectable()
export class BusinessProfileService {
  constructor(private readonly prisma: PrismaService) {}

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
