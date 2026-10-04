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
import {
  AdminCategoryDto,
  CategoryRecordDto,
  SubcategoryRecordDto,
} from './dto/category-response.dto';
import { SetCategoryLiveDto } from './dto/set-category-live.dto';
import {
  CreateCategoryDto,
  CreateSubcategoryDto,
  UpdateCategoryDto,
  UpdateSubcategoryDto,
} from './dto/category-crud.dto';

/**
 * The taxonomy: what exists, and which of it a business may choose (§98, §100).
 *
 * ## Nothing here is ever deleted — §101
 *
 * There is no delete, at either level. A category is **retired** by switching
 * it off, which is reversible, and a mistake in its name is fixed by renaming
 * it. Between them there is nothing a delete would do that these two do not do
 * better.
 *
 * Removing it also removes a hazard: `BusinessProfile.categoryId` is `SetNull`
 * and `Subcategory` cascades from its parent, so deleting a category in use
 * would silently strip the category from every business in it and take their
 * type with it. Guarding that was possible; not offering it is simpler and
 * cannot be got wrong.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('categories')
  @ApiOkResponse({ type: AdminCategoryDto, isArray: true })
  async findAll() {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        icon: true,
        description: true,
        isLive: true,
        _count: { select: { businesses: true } },
        subcategories: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            isLive: true,
            _count: { select: { businesses: true } },
          },
        },
      },
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      description: category.description,
      isLive: category.isLive,
      /** Businesses already in it. Shown before anything is switched off. */
      businessCount: category._count.businesses,
      subcategories: category.subcategories.map((subcategory) => ({
        id: subcategory.id,
        name: subcategory.name,
        isLive: subcategory.isLive,
        businessCount: subcategory._count.businesses,
        /**
         * What a business actually sees. A live type inside a hidden category
         * is not offered, and the screen should say that rather than show a
         * row that looks open and is not.
         */
        effectivelyLive: subcategory.isLive && category.isLive,
      })),
    }));
  }

  // ---------- Categories ----------

  @Post('categories')
  @ApiCreatedResponse({ type: CategoryRecordDto })
  async create(@Body() dto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name.trim(),
          icon: dto.icon?.trim() || null,
          description: dto.description?.trim() || null,
        },
      });
    } catch (error) {
      throw this.asConflict(error, `A category called "${dto.name.trim()}" already exists.`);
    }
  }

  @Patch('categories/:id')
  @ApiOkResponse({ type: CategoryRecordDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    await this.requireCategory(id);
    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon.trim() || null } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
        },
      });
    } catch (error) {
      throw this.asConflict(error, 'Another category already has that name.');
    }
  }

  @Patch('categories/:id/live')
  @ApiOkResponse({ type: ActionMessageDto })
  async setLive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCategoryLiveDto,
  ) {
    await this.requireCategory(id);
    await this.prisma.category.update({ where: { id }, data: { isLive: dto.isLive } });

    return {
      message: dto.isLive
        ? 'Businesses can choose this category again.'
        : 'New businesses can no longer choose this category. Existing ones keep their listing.',
    };
  }


  // ---------- Subcategories ----------

  @Post('categories/:id/subcategories')
  @ApiCreatedResponse({ type: SubcategoryRecordDto })
  async createSubcategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSubcategoryDto,
  ) {
    await this.requireCategory(id);
    try {
      return await this.prisma.subcategory.create({
        data: { categoryId: id, name: dto.name.trim() },
      });
    } catch (error) {
      throw this.asConflict(
        error,
        `This category already has a type called "${dto.name.trim()}".`,
      );
    }
  }

  @Patch('subcategories/:id')
  @ApiOkResponse({ type: SubcategoryRecordDto })
  async updateSubcategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubcategoryDto,
  ) {
    await this.requireSubcategory(id);
    try {
      return await this.prisma.subcategory.update({
        where: { id },
        data: { name: dto.name.trim() },
      });
    } catch (error) {
      throw this.asConflict(error, 'That category already has a type with that name.');
    }
  }

  @Patch('subcategories/:id/live')
  @ApiOkResponse({ type: ActionMessageDto })
  async setSubcategoryLive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCategoryLiveDto,
  ) {
    await this.requireSubcategory(id);
    await this.prisma.subcategory.update({ where: { id }, data: { isLive: dto.isLive } });

    return {
      message: dto.isLive
        ? 'Businesses can choose this type again.'
        : 'New businesses can no longer choose this type. Existing ones keep their listing.',
    };
  }


  // ---------- Shared ----------

  private async requireCategory(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        _count: { select: { businesses: true } },
        subcategories: { select: { _count: { select: { businesses: true } } } },
      },
    });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  private async requireSubcategory(id: string) {
    const subcategory = await this.prisma.subcategory.findUnique({
      where: { id },
      select: { id: true, _count: { select: { businesses: true } } },
    });
    if (!subcategory) throw new NotFoundException('Type not found.');
    return subcategory;
  }

  /**
   * Turns Prisma's unique-violation code into the sentence a person needs.
   * Anything else is rethrown — swallowing an unknown database error here
   * would report "already exists" for a problem that is nothing of the sort.
   */
  private asConflict(error: unknown, message: string) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException(message);
    }
    return error;
  }
}
