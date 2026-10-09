import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessStatus, NotificationType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  READINESS_SELECT,
  isReadyForReview,
  listInWords,
  readinessItems,
  readinessView,
} from './readiness';
// One select, shared with the DTO describing its result (§128.5).
import { PROFILE_SELECT } from './dto/business-response.dto';
import { StorageService } from '../storage/storage.service';
import { UpdateBusinessProfileDto } from './dto/update-profile.dto';
import { MAX_KIND_CATEGORIES } from './dto/set-kinds.dto';
import { OTHER, tidyLabel } from './kinds';

@Injectable()
export class BusinessProfileService {
  private readonly logger = new Logger(BusinessProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Going live (§255) ----------

  /** The shop's checklist: what it has, what it still needs, and whether it can send itself for review. */
  async readiness(businessId: string) {
    const shop = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: READINESS_SELECT,
    });
    if (!shop) throw new NotFoundException('Business not found.');
    return readinessView(shop);
  }

  /**
   * The shop sends itself to be reviewed (§255) — or, after a rejection, sends
   * itself BACK, having fixed what it was told.
   *
   * Not an administrator's transition, so it is not in
   * BUSINESS_STATUS_TRANSITIONS, which is the table of what an administrator
   * may decide: a shop can only ask. Asking moves a rejected shop back to
   * PENDING; it never makes anything live. Administrators are told.
   */
  async submitForReview(businessId: string) {
    const shop = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: READINESS_SELECT,
    });
    if (!shop) throw new NotFoundException('Business not found.');

    if (shop.status === BusinessStatus.APPROVED) {
      throw new BadRequestException('Your shop is already live.');
    }
    if (shop.status === BusinessStatus.SUSPENDED) {
      throw new BadRequestException(
        'A suspended shop cannot send itself for review. Raise a support ticket to talk it through.',
      );
    }
    if (shop.status === BusinessStatus.PENDING && shop.submittedAt) {
      throw new ConflictException('Your shop is already waiting for review.');
    }
    if (!isReadyForReview(shop)) {
      const missing = readinessItems(shop)
        .filter((item) => item.required && !item.done)
        .map((item) => item.key);
      throw new BadRequestException(
        `Your shop is not ready to be reviewed yet. Still to add: ${listInWords(missing)}.`,
      );
    }

    const resubmitted = shop.status === BusinessStatus.REJECTED;
    const updated = await this.prisma.businessProfile.update({
      where: { id: businessId },
      data: {
        status: BusinessStatus.PENDING,
        submittedAt: new Date(),
        // A shop waiting again is no longer rejected; what the rejection said
        // stays in `lastRejectionReason` for whoever reviews it next.
        ...(resubmitted ? { statusReason: null, statusChangedAt: new Date(), statusChangedById: null } : {}),
      },
      select: READINESS_SELECT,
    });

    this.logger.log(`Business ${businessId} ${resubmitted ? 'sent itself back' : 'sent itself'} for review.`);
    await this.notifyAdmins(updated.name ?? 'A shop', resubmitted);
    return readinessView(updated);
  }

  private async notifyAdmins(name: string, resubmitted: boolean) {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify({
          recipientId: admin.id,
          type: NotificationType.BUSINESS_SUBMITTED,
          context: {
            serviceName: 'Business review',
            locationName: name,
            businessName: name,
            startTime: undefined as unknown as Date,
            reason: resubmitted
              ? `${name} has fixed what its rejection asked for and sent itself back for review.`
              : `${name} has finished setting up and is ready for review.`,
          },
        }),
      ),
    );
  }

  /**
   * Stores a logo or cover image and records it on the profile (§88).
   *
   * The DTO has always accepted `logoUrl` and `coverImageUrl` as plain strings,
   * which quietly assumed the business already had the image hosted somewhere.
   * They do not — that is the whole reason this platform exists for them. So
   * the bytes come here, the same way a gallery photo does, and the profile
   * records the URL storage hands back.
   *
   * The previous image is removed after the row is updated, never before: a
   * failed write must not leave a profile pointing at a file that is gone.
   */
  async setImage(
    businessId: string,
    kind: 'logo' | 'cover',
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded.');

    const existing = await this.prisma.businessProfile.findUnique({
      where: { id: businessId },
      select: { logoUrl: true, coverImageUrl: true },
    });
    if (!existing) throw new NotFoundException('Business not found.');

    const url = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `businesses/${businessId}`,
    );

    const updated = await this.prisma.businessProfile.update({
      where: { id: businessId },
      data: kind === 'logo' ? { logoUrl: url } : { coverImageUrl: url },
      select: PROFILE_SELECT,
    });

    const previous = kind === 'logo' ? existing.logoUrl : existing.coverImageUrl;
    if (previous && previous !== url) {
      // Best-effort, and deliberately not awaited into the response path: an
      // orphaned object is a cleanup problem, a failed request is the user's.
      void this.storage.remove(previous);
    }

    return updated;
  }

  // Takes a businessId now, not a userId: the caller's business is resolved
  // once by BusinessRolesGuard, and several people may share it.
  async findOwn(businessId: string) {
    return this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: PROFILE_SELECT,
    });
  }

  /**
   * Every kind of place the business is (§265), in order — the first is its
   * main kind, mirrored on the profile's own category and type. Replaces the
   * whole list.
   *
   * A type no longer offered (it, or its category, switched off) may be KEPT
   * by a business that already has it — retiring a type never takes it away
   * from anyone (§98) — but not newly chosen.
   */
  async setKinds(businessId: string, subcategoryIds: string[], otherLabels: Array<{ subcategoryId: string; label: string }> = []) {
    const ids = [...new Set(subcategoryIds)];
    if (ids.length === 0) throw new BadRequestException('Choose at least one kind of shop.');

    const types = await this.prisma.subcategory.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, isLive: true, categoryId: true, category: { select: { isLive: true } } },
    });
    if (types.length !== ids.length) throw new BadRequestException('One of those kinds does not exist.');

    const held = new Set(
      (await this.prisma.businessKind.findMany({ where: { businessId }, select: { subcategoryId: true } })).map(
        (k) => k.subcategoryId,
      ),
    );
    const retired = types.find((t) => !(t.isLive && t.category.isLive) && !held.has(t.id));
    if (retired) throw new BadRequestException(`${retired.name} is not offered any more — choose another kind.`);

    if (new Set(types.map((t) => t.categoryId)).size > MAX_KIND_CATEGORIES) {
      throw new BadRequestException(`Choose up to ${MAX_KIND_CATEGORIES} kinds of shop.`);
    }

    // What a shop wrote under "Other" (§267) — only for an "Other", only for a kind it lists.
    const labels = new Map<string, string>();
    for (const { subcategoryId, label } of otherLabels) {
      const type = types.find((t) => t.id === subcategoryId);
      if (!type) throw new BadRequestException('A written-in kind must be one of the kinds chosen.');
      if (type.name !== OTHER) throw new BadRequestException(`Only "${OTHER}" takes a written-in kind — ${type.name} is already named.`);
      labels.set(subcategoryId, tidyLabel(label));
    }

    const before = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, status: true, kinds: { select: { subcategoryId: true, otherLabel: true } } },
    });

    const byId = new Map(types.map((t) => [t.id, t]));
    const main = byId.get(ids[0])!;
    const profile = await this.prisma.$transaction(async (tx) => {
      await this.writeKinds(
        tx,
        businessId,
        ids.map((id) => ({ id, categoryId: byId.get(id)!.categoryId, otherLabel: labels.get(id) ?? null })),
      );
      return tx.businessProfile.update({
        where: { id: businessId },
        data: { categoryId: main.categoryId, subcategoryId: main.id },
        select: PROFILE_SELECT,
      });
    });

    // A LIVE shop's write-in is words customers read that nobody has checked:
    // an administrator is told when one is new or changed (§267). A shop not
    // yet live is checked when it is reviewed.
    if (before.status === BusinessStatus.APPROVED) {
      const had = new Map(before.kinds.map((k) => [k.subcategoryId, k.otherLabel]));
      for (const kind of profile.kinds) {
        if (kind.otherLabel && kind.otherLabel !== had.get(kind.subcategory.id)) {
          await this.notifyAdminsOfWriteIn(before.name ?? 'A shop', kind.otherLabel, kind.category.name);
        }
      }
    }
    return profile;
  }

  private async notifyAdminsOfWriteIn(name: string, label: string, category: string) {
    const admins = await this.prisma.user.findMany({ where: { role: UserRole.ADMIN }, select: { id: true } });
    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify({
          recipientId: admin.id,
          type: NotificationType.BUSINESS_KIND_WRITTEN,
          context: {
            serviceName: 'Business review',
            locationName: name,
            businessName: name,
            startTime: undefined as unknown as Date,
            reason: `${name} now calls itself “${label}”, under ${category} · ${OTHER}. It is live, so customers already see it.`,
          },
        }),
      ),
    );
  }

  /** The kinds, in order, replacing what was there (§265). */
  private async writeKinds(
    tx: Prisma.TransactionClient,
    businessId: string,
    kinds: Array<{ id: string; categoryId: string; otherLabel?: string | null }>,
  ) {
    await tx.businessKind.deleteMany({ where: { businessId } });
    if (kinds.length === 0) return;
    await tx.businessKind.createMany({
      data: kinds.map((k, position) => ({
        businessId,
        subcategoryId: k.id,
        categoryId: k.categoryId,
        position,
        otherLabel: k.otherLabel ?? null,
      })),
    });
  }

  async update(businessId: string, dto: UpdateBusinessProfileDto) {
    const current = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, categoryId: true, subcategoryId: true, status: true },
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

    const nextSubcategoryId = clearSubcategory ? null : (subcategoryId ?? current.subcategoryId);
    return this.prisma.$transaction(async (tx) => {
      // The main kind changed here — the one-kind form, or an older client —
      // so the list of kinds follows (§265): the new main first, the old main
      // gone, the others kept in their order.
      if (nextSubcategoryId !== current.subcategoryId) {
        const others = await tx.businessKind.findMany({
          where: { businessId, subcategoryId: { notIn: [current.subcategoryId, nextSubcategoryId].filter((v): v is string => Boolean(v)) } },
          orderBy: { position: 'asc' },
          select: { subcategoryId: true, categoryId: true, otherLabel: true },
        });
        const main = nextSubcategoryId && categoryId ? [{ id: nextSubcategoryId, categoryId }] : [];
        await this.writeKinds(tx, businessId, [
          ...main,
          ...others.map((k) => ({ id: k.subcategoryId, categoryId: k.categoryId, otherLabel: k.otherLabel })),
        ]);
      }
      return tx.businessProfile.update({
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
    });
  }
}
