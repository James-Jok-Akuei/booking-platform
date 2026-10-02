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
      // A province with nothing open in it is noise in a filter row.
      where: { districts: { some: { isLive: true } } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        districts: {
          // Only where the platform is open (§105). A retired district is not
          // offered to a new branch and not shown as a filter — the customer
          // would otherwise pick a place with nothing in it.
          where: { isLive: true },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true },
        },
      },
    });
  }
}
