import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SetCategoryLiveDto } from './dto/set-category-live.dto';

/**
 * Which categories a business may choose (§98).
 *
 * The platform ships the whole taxonomy and opens part of it. This is the only
 * place that decides which part, and the counts are what make the decision
 * answerable: switching a category off while businesses are in it is allowed,
 * but nobody should do it without seeing how many.
 */
@Controller('admin/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        icon: true,
        description: true,
        isLive: true,
        _count: { select: { businesses: true, subcategories: true } },
      },
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      description: category.description,
      isLive: category.isLive,
      /** How many businesses are already in it. Shown before it is switched off. */
      businessCount: category._count.businesses,
      subcategoryCount: category._count.subcategories,
    }));
  }

  @Patch(':id/live')
  async setLive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCategoryLiveDto,
  ) {
    await this.prisma.category.update({
      where: { id },
      data: { isLive: dto.isLive },
    });

    return {
      message: dto.isLive
        ? 'Businesses can choose this category again.'
        : 'New businesses can no longer choose this category. Existing ones keep their listing.',
    };
  }
}
