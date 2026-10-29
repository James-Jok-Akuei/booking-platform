import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  AdminProvinceDto,
  DistrictRecordDto,
} from './dto/place-response.dto';
import {
  CreateDistrictDto,
  SetDistrictLiveDto,
  UpdateDistrictDto,
} from './dto/places.dto';

/**
 * Where the platform is open for business (§105).
 *
 * Rwanda's thirty districts are a fact of the country. Which of them this
 * platform trades in is a decision, and this is where it is made: open Musanze
 * when there is someone to serve there, retire it if that changes.
 *
 * ## There is no delete
 *
 * §101, and here the reasoning is stronger than it was for categories: a
 * district may be the recorded location of branches, past bookings and the
 * ledger entries behind them. Retiring takes it out of the picker and the
 * customer's filter; branches already there keep their listing, exactly as a
 * retired category's businesses do (§98.1).
 */
@Controller('admin/places')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true, conflict: true })
export class AdminPlacesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything, open or not — the one listing that shows retired districts. */
  @Get('provinces')
  @ApiOkResponse({ type: AdminProvinceDto, isArray: true })
  async findAll() {
    const provinces = await this.prisma.province.findMany({
      // By country first (§315), so each country's places read together.
      orderBy: [{ countryCode: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        countryCode: true,
        districts: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            isLive: true,
            _count: { select: { locations: true } },
          },
        },
      },
    });

    return provinces.map((province) => ({
      id: province.id,
      code: province.code,
      name: province.name,
      countryCode: province.countryCode,
      districts: province.districts.map((district) => ({
        id: district.id,
        code: district.code,
        name: district.name,
        isLive: district.isLive,
        /** Branches already there. Shown before anything is retired. */
        branchCount: district._count.locations,
      })),
    }));
  }

  @Post('districts')
  @ApiCreatedResponse({ type: DistrictRecordDto })
  async create(@Body() dto: CreateDistrictDto) {
    const province = await this.prisma.province.findUnique({
      where: { id: dto.provinceId },
      select: { id: true },
    });
    if (!province) throw new NotFoundException('Province not found.');

    try {
      return await this.prisma.district.create({
        data: {
          provinceId: dto.provinceId,
          name: dto.name.trim(),
          code: dto.code.trim(),
        },
      });
    } catch (error) {
      throw this.asConflict(
        error,
        `A district called "${dto.name.trim()}" or coded "${dto.code.trim()}" already exists.`,
      );
    }
  }

  @Patch('districts/:id')
  @ApiOkResponse({ type: DistrictRecordDto })
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDistrictDto,
  ) {
    await this.require(id);
    try {
      return await this.prisma.district.update({
        where: { id },
        data: { name: dto.name.trim() },
      });
    } catch (error) {
      throw this.asConflict(error, 'That province already has a district with that name.');
    }
  }

  @Patch('districts/:id/live')
  @ApiOkResponse({ type: ActionMessageDto })
  async setLive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDistrictLiveDto,
  ) {
    const district = await this.require(id);
    await this.prisma.district.update({ where: { id }, data: { isLive: dto.isLive } });

    const n = district._count.locations;
    return {
      message: dto.isLive
        ? 'The platform is open here again. Businesses can choose it.'
        : `Retired. New branches cannot choose it${
            n > 0
              ? `, and the ${n} already there keep their listing.`
              : '.'
          }`,
    };
  }

  private async require(id: string) {
    const district = await this.prisma.district.findUnique({
      where: { id },
      select: { id: true, _count: { select: { locations: true } } },
    });
    if (!district) throw new NotFoundException('District not found.');
    return district;
  }

  /** Prisma's unique violation, as the sentence a person needs. */
  private asConflict(error: unknown, message: string) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(message);
    }
    return error;
  }
}
