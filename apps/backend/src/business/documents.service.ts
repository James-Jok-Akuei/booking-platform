import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BusinessDocumentKind as K,
  BusinessDocumentStatus as S,
  BusinessStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { say } from '../i18n/say';
import { EXPIRY_WARNING_DAYS, KIND_WORDS, isRegistered, paperKinds, requiredPapers, ruleState } from './document-rules';
import type { BusinessDocumentDto, BusinessDocumentsDto, UploadDocumentDto } from './dto/documents.dto';

const DOCUMENT_SELECT = {
  id: true,
  businessId: true,
  kind: true,
  label: true,
  number: true,
  expiresAt: true,
  fileKey: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  refusalReason: true,
  checkedAt: true,
  createdAt: true,
  uploadedBy: { select: { email: true } },
} satisfies Prisma.BusinessDocumentSelect;

type Row = Prisma.BusinessDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

/** A paper's day, as the shop typed it — kept to the end of that day. */
const endOfDay = (ymd: string) => new Date(`${ymd}T23:59:59.999Z`);

/**
 * Business papers (§314): a shop's registration and the licences its kind of
 * shop must hold. Uploaded by the owner or a manager of every branch, kept
 * in private storage, checked by our team — a licensed trade cannot be
 * approved until its licence is checked (`readiness.ts`), and a checked
 * registration earns the "Registered business" mark customers see.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- The shop ----------

  async list(businessId: string): Promise<BusinessDocumentsDto> {
    const [shop, rows] = await Promise.all([this.shop(businessId), this.rows(businessId)]);
    return this.view(shop, rows);
  }

  /**
   * A new paper. One of a kind: the previous one of that kind — waiting,
   * checked or refused — is replaced, so a renewed licence takes the old
   * one's place; "another paper" may be several.
   */
  async upload(
    businessId: string,
    userId: string,
    dto: UploadDocumentDto,
    file: Express.Multer.File | undefined,
  ): Promise<BusinessDocumentDto> {
    if (!file) throw new BadRequestException('Attach the paper as a PDF or a photo (JPG, PNG or WebP).');
    if (dto.kind === K.OTHER && !dto.label?.trim()) {
      throw new BadRequestException('Say what the paper is, in a few words.');
    }
    const expiresAt = dto.expiresAt ? endOfDay(dto.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException('That end date is not a real day.');
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This paper has already run out. Upload the renewed one.');
    }

    const shop = await this.shop(businessId);
    // Only the papers of the shop's own country (§315): an RDB certificate means nothing in Kenya.
    if (!paperKinds(shop.countryCode).includes(dto.kind)) {
      throw new BadRequestException('That paper is not one a shop in this country can upload.');
    }
    const key = await this.storage.uploadPrivate(file.buffer, file.mimetype, `documents/${businessId}`);

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.kind !== K.OTHER) {
        await tx.businessDocument.updateMany({
          where: { businessId, kind: dto.kind, status: { in: [S.SUBMITTED, S.VERIFIED, S.REFUSED] } },
          data: { status: S.REPLACED },
        });
      }
      return tx.businessDocument.create({
        data: {
          businessId,
          uploadedById: userId,
          kind: dto.kind,
          label: dto.kind === K.OTHER ? dto.label!.trim() : null,
          number: dto.number?.trim() || null,
          expiresAt,
          fileKey: key,
          fileName: file.originalname.slice(0, 200),
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
        select: DOCUMENT_SELECT,
      });
    });

    this.logger.log(`Business ${businessId} uploaded a ${dto.kind} (${file.size} bytes) as document ${row.id}.`);

    // Our team checks it — once the shop is in front of them: sent for review,
    // or already live. A shop still setting up is seen when it sends itself.
    if (shop.submittedAt !== null || shop.status !== BusinessStatus.PENDING) {
      await this.tellAdmins(businessId, shop.name, row.kind);
    }
    return this.one(row);
  }

  /** Taking a paper back: only one our team has not accepted. A checked one is replaced, never removed. */
  /** Takes a paper off the record and answers with the papers that remain. */
  async remove(businessId: string, id: string): Promise<BusinessDocumentsDto> {
    const row = await this.prisma.businessDocument.findFirst({ where: { id, businessId }, select: DOCUMENT_SELECT });
    if (!row) throw new NotFoundException('Paper not found.');
    if (row.status === S.VERIFIED) {
      throw new BadRequestException('This paper has been checked, so it stays. Upload a newer one to replace it.');
    }
    await this.prisma.businessDocument.delete({ where: { id } });
    await this.storage.removePrivate(row.fileKey);
    return this.list(businessId);
  }

  /** The file, for the shop's own route. */
  async file(businessId: string, id: string) {
    const row = await this.prisma.businessDocument.findFirst({ where: { id, businessId }, select: DOCUMENT_SELECT });
    if (!row) throw new NotFoundException('Paper not found.');
    return this.bytes(row);
  }

  // ---------- Our team ----------

  async listForAdmin(actor: { role: UserRole | string }, businessId: string): Promise<BusinessDocumentsDto> {
    this.assertAdmin(actor);
    return this.list(businessId);
  }

  async fileForAdmin(actor: { role: UserRole | string }, businessId: string, id: string) {
    this.assertAdmin(actor);
    return this.file(businessId, id);
  }

  async verify(actor: { userId: string; role: UserRole | string }, businessId: string, id: string): Promise<BusinessDocumentDto> {
    this.assertAdmin(actor);
    const row = await this.requireWaiting(businessId, id);
    const updated = await this.prisma.businessDocument.update({
      where: { id },
      data: { status: S.VERIFIED, checkedById: actor.userId, checkedAt: new Date(), refusalReason: null },
      select: DOCUMENT_SELECT,
    });
    this.logger.log(`Document ${id} (${row.kind}) of business ${businessId} VERIFIED by admin ${actor.userId}.`);
    await this.tellShop(businessId, NotificationType.BUSINESS_DOCUMENT_VERIFIED, updated);
    return this.one(updated);
  }

  async refuse(
    actor: { userId: string; role: UserRole | string },
    businessId: string,
    id: string,
    reason: string,
  ): Promise<BusinessDocumentDto> {
    this.assertAdmin(actor);
    const row = await this.requireWaiting(businessId, id);
    const updated = await this.prisma.businessDocument.update({
      where: { id },
      data: { status: S.REFUSED, checkedById: actor.userId, checkedAt: new Date(), refusalReason: reason.trim() },
      select: DOCUMENT_SELECT,
    });
    this.logger.warn(`Document ${id} (${row.kind}) of business ${businessId} REFUSED by admin ${actor.userId}: ${reason.trim()}`);
    await this.tellShop(businessId, NotificationType.BUSINESS_DOCUMENT_REFUSED, updated);
    return this.one(updated);
  }

  // ---------- Run daily ----------

  /**
   * Papers running out (§314): a word a month before, and another when they
   * have — once each, so a shop that has already renewed hears nothing more.
   */
  /** `countryCode`: only that country's shops (§315) — the scheduler asks each at its own morning. */
  async expiryReminders(now = new Date(), countryCode?: string): Promise<number> {
    const soon = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 86_400_000);
    const due = await this.prisma.businessDocument.findMany({
      where: {
        status: { in: [S.SUBMITTED, S.VERIFIED] },
        expiresAt: { not: null, lte: soon },
        reminderStage: { lt: 2 },
        ...(countryCode ? { business: { countryCode } } : {}),
      },
      select: DOCUMENT_SELECT,
    });
    let told = 0;
    for (const row of due) {
      const expired = row.expiresAt!.getTime() <= now.getTime();
      const stage = expired ? 2 : 1;
      // Already told at this stage: nothing more until the next one.
      const current = await this.prisma.businessDocument.findUnique({ where: { id: row.id }, select: { reminderStage: true } });
      if (!current || current.reminderStage >= stage) continue;
      await this.prisma.businessDocument.update({ where: { id: row.id }, data: { reminderStage: stage } });
      await this.tellShop(row.businessId, NotificationType.BUSINESS_DOCUMENT_EXPIRING, row, expired);
      told++;
    }
    return told;
  }

  // ---------- Pieces ----------

  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) throw new NotFoundException('Not found.');
  }

  private shop(businessId: string) {
    return this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        name: true,
        status: true,
        submittedAt: true,
        countryCode: true,
        kinds: { select: { category: { select: { name: true } }, subcategory: { select: { name: true } } } },
      },
    });
  }

  private rows(businessId: string) {
    return this.prisma.businessDocument.findMany({
      where: { businessId, status: { not: S.REPLACED } },
      orderBy: { createdAt: 'desc' },
      select: DOCUMENT_SELECT,
    });
  }

  private async requireWaiting(businessId: string, id: string) {
    const row = await this.prisma.businessDocument.findFirst({ where: { id, businessId }, select: DOCUMENT_SELECT });
    if (!row) throw new NotFoundException('Paper not found.');
    if (row.status !== S.SUBMITTED) {
      throw new BadRequestException(`Only a paper waiting to be checked can be decided. This one is ${row.status}.`);
    }
    return row;
  }

  private async bytes(row: Row) {
    return { buffer: await this.storage.readPrivate(row.fileKey), mimeType: row.mimeType, fileName: row.fileName };
  }

  private view(shop: Awaited<ReturnType<DocumentsService['shop']>>, rows: Row[]): BusinessDocumentsDto {
    const now = new Date();
    return {
      registered: isRegistered(shop.countryCode, rows, now),
      required: requiredPapers(shop.countryCode, shop.kinds).map((rule) => ({ key: rule.key, kinds: rule.kinds, state: ruleState(rule, rows, now) })),
      documents: rows.map((row) => this.one(row, now)),
      canUpload: this.storage.privateStorageReady(),
    };
  }

  private one(row: Row, now = new Date()): BusinessDocumentDto {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      number: row.number,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      refusalReason: row.refusalReason,
      checkedAt: row.checkedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      expired: row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime(),
      uploadedBy: row.uploadedBy.email,
    };
  }

  /** To the owner and every-branch managers (§277) — the people who run the business. */
  private async tellShop(businessId: string, type: NotificationType, row: Row, expired = false) {
    const shop = await this.prisma.businessProfile.findUnique({ where: { id: businessId }, select: { name: true } });
    await this.notifications.notifyBusiness({
      businessId,
      type,
      moneyOnly: true,
      context: {
        serviceName: 'Business papers',
        locationName: 'your business',
        businessName: shop?.name ?? 'your business',
        startTime: undefined as unknown as Date,
        reason: row.refusalReason ?? undefined,
        document: { kind: row.kind, label: row.label, expiresAt: row.expiresAt, expired },
      },
    });
  }

  /** To every administrator (§314): a paper to check, with the shop open. */
  private async tellAdmins(businessId: string, shopName: string | null, kind: K) {
    const admins = await this.prisma.user.findMany({ where: { role: UserRole.ADMIN, closedAt: null }, select: { id: true } });
    const name = shopName ?? 'A shop';
    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify({
          recipientId: admin.id,
          type: NotificationType.BUSINESS_DOCUMENT_SUBMITTED,
          link: `/businesses?status=ALL&open=${businessId}`,
          context: {
            serviceName: 'Business papers',
            locationName: name,
            businessName: name,
            startTime: undefined as unknown as Date,
            reason: `${name} uploaded a ${say(DEFAULT_LOCALE as Locale, KIND_WORDS[kind]).toLowerCase()}.`,
          },
        }),
      ),
    );
  }
}
