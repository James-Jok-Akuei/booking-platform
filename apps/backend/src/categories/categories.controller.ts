import { Controller, Get } from '@nestjs/common';
import { otherLast } from './other-last';
import { PrismaService } from '../prisma/prisma.service';
import { ApiOkResponse } from '@nestjs/swagger';
import { CategoryDto, PUBLIC_CATEGORY_SELECT } from './dto/category-response.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public and unauthenticated on purpose — deliberately the only endpoint in
   * this module without JwtAuthGuard. Both sides need the taxonomy before they
   * have a token: a business picks its category during onboarding, and a
   * customer browses categories before signing up at all.
   *
   * Seeded by prisma/seed.ts.
   */
  @Get()
  @ApiOkResponse({ type: CategoryDto, isArray: true })
  async findAll() {
    const categories = await this.prisma.category.findMany({
      // Only what a business may choose (§98). Discovery is NOT filtered this
      // way — a shop already in a category that was switched off keeps its
      // listing, because it did not make that decision.
      where: { isLive: true },
      orderBy: { name: 'asc' },
      // One select, shared with the DTO that describes it (§128.5).
      select: PUBLIC_CATEGORY_SELECT,
    });
    return categories.map((category) => ({ ...category, subcategories: otherLast(category.subcategories) }));
  }
}
