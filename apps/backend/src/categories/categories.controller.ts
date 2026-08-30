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
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        icon: true,
        description: true,
        subcategories: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        },
      },
    });
  }
}
