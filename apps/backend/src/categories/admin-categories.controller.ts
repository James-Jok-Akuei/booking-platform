import { otherLast } from './other-last';
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
  AdminWriteInDto,
  CategoryRecordDto,
  PromotedWriteInDto,
  SubcategoryRecordDto,
} from './dto/category-response.dto';
import { OTHER } from '../business/kinds';
import { TaxonomyNamesService } from './taxonomy-names.service';
import { readTranslations } from './taxonomy-words';
import { SetCategoryLiveDto } from './dto/set-category-live.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  CreateCategoryDto,
  CreateSubcategoryDto,
  PromoteWriteInDto,
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
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true, conflict: true })
export class AdminCategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly names: TaxonomyNamesService,
  ) {}

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
        translations: true,
        isLive: true,
        subcategories: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            translations: true,
            isLive: true,
            _count: { select: { kinds: true } },
          },
        },
      },
    });

    // Businesses in each category, counted ONCE however many of its types
    // they list (§265) — by their kinds, and by the main category of any that
    // chose a category before choosing a type.
    const [kinds, mains] = await Promise.all([
      this.prisma.businessKind.findMany({ distinct: ['categoryId', 'businessId'], select: { categoryId: true, businessId: true } }),
      this.prisma.businessProfile.findMany({ where: { categoryId: { not: null } }, select: { id: true, categoryId: true } }),
    ]);
    const inCategory = new Map<string, Set<string>>();
    const count = (categoryId: string, businessId: string) => {
      if (!inCategory.has(categoryId)) inCategory.set(categoryId, new Set());
      inCategory.get(categoryId)!.add(businessId);
    };
    kinds.forEach((k) => count(k.categoryId, k.businessId));
    mains.forEach((b) => count(b.categoryId!, b.id));

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      description: category.description,
      translations: readTranslations(category.translations),
      isLive: category.isLive,
      /** Businesses already in it. Shown before anything is switched off. */
      businessCount: inCategory.get(category.id)?.size ?? 0,
      subcategories: otherLast(category.subcategories).map((subcategory) => ({
        id: subcategory.id,
        name: subcategory.name,
        translations: readTranslations(subcategory.translations),
        isLive: subcategory.isLive,
        businessCount: subcategory._count.kinds,
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
      const created = await this.prisma.category.create({
        data: {
          name: dto.name.trim(),
          icon: dto.icon?.trim() || null,
          description: dto.description?.trim() || null,
          ...(dto.translations ? { translations: readTranslations(dto.translations) } : {}),
        },
      });
      this.names.forget();
      return created;
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
      const updated = await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon.trim() || null } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
          // The boxes as they are now: a language emptied is a language removed.
          ...(dto.translations !== undefined ? { translations: readTranslations(dto.translations) } : {}),
        },
      });
      this.names.forget();
      return updated;
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
      const created = await this.prisma.subcategory.create({
        data: {
          categoryId: id,
          name: dto.name.trim(),
          ...(dto.translations ? { translations: readTranslations(dto.translations) } : {}),
        },
      });
      this.names.forget();
      return created;
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
      const updated = await this.prisma.subcategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.translations !== undefined ? { translations: readTranslations(dto.translations) } : {}),
        },
      });
      this.names.forget();
      return updated;
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

  // ---------- What shops wrote under "Other" (§267) ----------

  /**
   * Every write-in, grouped by category and by what was written (case and
   * spacing aside), most-written first — the types the taxonomy may be missing.
   */
  @Get('categories/write-ins')
  @ApiOkResponse({ type: AdminWriteInDto, isArray: true })
  async writeIns(): Promise<AdminWriteInDto[]> {
    const kinds = await this.prisma.businessKind.findMany({
      where: { otherLabel: { not: null }, subcategory: { name: OTHER } },
      orderBy: { createdAt: 'asc' },
      select: {
        otherLabel: true,
        category: { select: { id: true, name: true, icon: true } },
        business: { select: { id: true, name: true } },
      },
    });
    const groups = new Map<string, { row: AdminWriteInDto; spellings: Map<string, number> }>();
    for (const kind of kinds) {
      const label = kind.otherLabel!;
      const key = `${kind.category.id}:${label.toLowerCase()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          row: { categoryId: kind.category.id, categoryName: kind.category.name, categoryIcon: kind.category.icon, label, count: 0, businesses: [] },
          spellings: new Map(),
        });
      }
      const group = groups.get(key)!;
      group.row.count += 1;
      group.row.businesses.push(kind.business);
      group.spellings.set(label, (group.spellings.get(label) ?? 0) + 1);
    }
    return [...groups.values()]
      .map(({ row, spellings }) => ({ ...row, label: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  /**
   * Makes a write-in a type of its own (or uses the category's type of that
   * name, if there is one), and moves every shop that wrote it from "Other"
   * into it (§267). A shop that already lists that type just loses its "Other".
   */
  @Post('categories/:id/write-ins/promote')
  @ApiCreatedResponse({ type: PromotedWriteInDto })
  async promoteWriteIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoteWriteInDto,
  ): Promise<PromotedWriteInDto> {
    await this.requireCategory(id);
    const label = dto.label.trim().toLowerCase();
    const name = (dto.name ?? dto.label).trim().replace(/\s+/g, ' ');
    if (name.toLowerCase() === OTHER.toLowerCase()) {
      throw new ConflictException(`A type cannot be called "${OTHER}".`);
    }

    const promoted = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subcategory.findFirst({
        where: { categoryId: id, name: { equals: name, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      const type = existing ?? (await tx.subcategory.create({ data: { categoryId: id, name }, select: { id: true, name: true } }));

      const writers = (
        await tx.businessKind.findMany({
          where: { categoryId: id, subcategory: { name: OTHER }, otherLabel: { not: null } },
          select: { id: true, businessId: true, subcategoryId: true, otherLabel: true },
        })
      ).filter((k) => k.otherLabel!.trim().toLowerCase() === label);

      for (const kind of writers) {
        const already = await tx.businessKind.findUnique({
          where: { businessId_subcategoryId: { businessId: kind.businessId, subcategoryId: type.id } },
          select: { id: true },
        });
        if (already) await tx.businessKind.delete({ where: { id: kind.id } });
        else await tx.businessKind.update({ where: { id: kind.id }, data: { subcategoryId: type.id, otherLabel: null } });
        // The main kind is mirrored on the profile (§265).
        await tx.businessProfile.updateMany({
          where: { id: kind.businessId, subcategoryId: kind.subcategoryId },
          data: { subcategoryId: type.id },
        });
      }
      return { subcategoryId: type.id, name: type.name, moved: writers.length };
    });
    // A new type: the apps' words are read again (§308.3).
    this.names.forget();
    return promoted;
  }

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
