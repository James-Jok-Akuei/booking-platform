import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  findAll() {
    return this.prisma.category.findMany({
      // Only what a business may choose (§98). Discovery is NOT filtered this
      // way — a shop already in a category that was switched off keeps its
      // listing, because it did not make that decision.
      where: { isLive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        icon: true,
        description: true,
        subcategories: {
          // ANDed with the parent by construction: a hidden category is not
          // returned at all, so its live children never reach anyone (§100).
          where: { isLive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        },
      },
    });
  }
}
