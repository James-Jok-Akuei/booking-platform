import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Where a business can be, and what a customer can filter by (§104).
 *
 * Public and unauthenticated, for the same reason the category taxonomy is: a
 * customer browses by place before they have an account, and a business picks
 * one during onboarding.
 *
 * Districts come nested inside their province. The two are never useful apart
 * — a district list with no province is thirty names in no order anyone thinks
 * in.
 */
@Controller('places')
export class PlacesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('provinces')
  findAll() {
    return this.prisma.province.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        districts: {
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true },
        },
      },
    });
  }
}
