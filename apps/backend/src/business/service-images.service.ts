import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { StorageService } from '../storage/storage.service';
import { BusinessAccessService } from './business-access.service';

/**
 * Upper bound on photos per SERVICE (§132).
 *
 * Eleven, as asked for. Per service rather than per business, and separate from
 * the location gallery's thirty: a shop with twenty services gets eleven photos
 * for each, because the photos answer "what does this haircut look like" and a
 * shared pool would have services competing for it.
 *
 * Not a number anyone should have to guess at from a failed upload, which is
 * why the listing publishes `limit` and `remaining` and the error names it.
 */
export const MAX_IMAGES_PER_SERVICE = 11;

/**
 * Photos of a service, uploaded by the business and shown to customers.
 *
 * Mirrors GalleryService deliberately — same order of checks, same storage
 * call, same shape of answer — because that flow is proven and the two differ
 * only in what they hang off. What is NOT shared is the table (§132) or this
 * class: one service handling both would need a "which kind" argument threaded
 * through every method.
 */
@Injectable()
export class ServiceImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: BusinessAccessService,
  ) {}

  async upload(
    userId: string,
    serviceId: string,
    file: Express.Multer.File | undefined,
    displayOrder?: number,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded. Send the image as multipart/form-data under the field name "file".',
      );
    }

    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedService(businessId, serviceId);

    // Counted AFTER ownership, so a stranger probing a service id learns
    // nothing about how many photos somebody else's service has.
    const existing = await this.prisma.serviceMedia.count({ where: { serviceId } });
    if (existing >= MAX_IMAGES_PER_SERVICE) {
      throw new BadRequestException(
        `This service already has the maximum of ${MAX_IMAGES_PER_SERVICE} photos. ` +
          'Delete one before uploading another.',
      );
    }

    // Stored first: an orphaned object costs a few KB, whereas a row pointing
    // at a file that was never written is a broken image forever.
    const url = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `services/${serviceId}`,
    );

    return this.prisma.serviceMedia.create({
      data: {
        serviceId,
        type: MediaType.PHOTO,
        url,
        // Appended by default. A client that cares about the cover photo sends
        // its own order; one that does not gets upload order, which is what a
        // person uploading in order expects.
        displayOrder: displayOrder ?? existing,
      },
    });
  }

  /** The business's own view, with the room left in it so a screen can say so. */
  async list(userId: string, serviceId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedService(businessId, serviceId);

    const images = await this.prisma.serviceMedia.findMany({
      where: { serviceId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      images,
      count: images.length,
      limit: MAX_IMAGES_PER_SERVICE,
      remaining: MAX_IMAGES_PER_SERVICE - images.length,
    };
  }

  /**
   * Makes one photo the cover (§187): first in the order, which is what every
   * customer screen leads with — the card on Home, the shop's row, the big
   * photo on the service's page, the saved list. The others keep their order
   * behind it, renumbered 1, 2, 3… so the order has no gaps or ties left to
   * break by upload time.
   *
   * Answers with the new listing, so a screen can redraw from what is stored.
   */
  async setCover(userId: string, serviceId: string, imageId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedService(businessId, serviceId);

    const images = await this.prisma.serviceMedia.findMany({
      where: { serviceId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    // An id from another service matches nothing here — the same 404 as remove.
    if (!images.some((image) => image.id === imageId)) {
      throw new NotFoundException('Photo not found.');
    }

    const order = [imageId, ...images.map((image) => image.id).filter((id) => id !== imageId)];
    await this.prisma.$transaction(
      order.map((id, displayOrder) =>
        this.prisma.serviceMedia.update({ where: { id }, data: { displayOrder } }),
      ),
    );
    return this.list(userId, serviceId);
  }

  async remove(
    userId: string,
    serviceId: string,
    imageId: string,
  ): Promise<ActionMessageDto> {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedService(businessId, serviceId);

    // Scoped by serviceId as well as by id: an image id from another service
    // matches no row rather than being deleted out of it.
    const image = await this.prisma.serviceMedia.findFirst({
      where: { id: imageId, serviceId },
      select: { id: true, url: true },
    });
    if (!image) {
      throw new NotFoundException('Photo not found.');
    }

    await this.prisma.serviceMedia.delete({ where: { id: image.id } });

    // After the row, and not awaited into the failure path: a file left behind
    // is a cleanup job, a half-deleted photo that still lists is a bug.
    await this.storage.remove(image.url).catch(() => undefined);

    return { message: 'Photo deleted.' };
  }
}
