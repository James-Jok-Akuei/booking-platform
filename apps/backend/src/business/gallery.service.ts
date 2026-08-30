import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BusinessAccessService } from './business-access.service';

/**
 * Upper bound on photos per location.
 *
 * Per *location*, not per business: a gallery exists to show a customer what
 * the place they are about to walk into actually looks like, so a chain's
 * downtown branch and its mall kiosk each get their own 30 rather than
 * competing for one shared pool.
 */
export const MAX_GALLERY_PHOTOS_PER_LOCATION = 30;

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: BusinessAccessService,
  ) {}

  async upload(
    userId: string,
    locationId: string,
    file: Express.Multer.File | undefined,
    displayOrder?: number,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded. Send the image as multipart/form-data under the field name "file".',
      );
    }

    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    // Checked after ownership so a stranger probing a location id learns
    // nothing about how full someone else's gallery is.
    const existing = await this.prisma.locationMedia.count({ where: { locationId } });
    if (existing >= MAX_GALLERY_PHOTOS_PER_LOCATION) {
      throw new BadRequestException(
        `This location already has the maximum of ${MAX_GALLERY_PHOTOS_PER_LOCATION} photos. ` +
          'Delete an existing photo before uploading a new one.',
      );
    }

    // Uploaded to storage first: an orphaned object costs a few KB, whereas a
    // row pointing at a file that was never written is a broken image forever.
    const url = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `locations/${locationId}`,
    );

    return this.prisma.locationMedia.create({
      data: {
        locationId,
        type: MediaType.PHOTO,
        url,
        // Default to the end of the gallery when the client doesn't care.
        displayOrder: displayOrder ?? existing,
        // status defaults to PENDING — media is moderated before it goes public.
      },
    });
  }

  async list(userId: string, locationId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const photos = await this.prisma.locationMedia.findMany({
      where: { locationId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // The owner sees every photo including PENDING and REJECTED ones — this is
    // their management view. Customer-facing endpoints must filter to APPROVED.
    return {
      photos,
      count: photos.length,
      limit: MAX_GALLERY_PHOTOS_PER_LOCATION,
      remaining: MAX_GALLERY_PHOTOS_PER_LOCATION - photos.length,
    };
  }

  async remove(userId: string, locationId: string, mediaId: string) {
    const businessId = await this.access.requireBusinessId(userId);
    await this.access.requireOwnedLocation(businessId, locationId);

    const media = await this.prisma.locationMedia.findFirst({
      where: { id: mediaId, locationId },
    });

    if (!media) {
      throw new NotFoundException('Photo not found.');
    }

    // Row first, then the object. StorageService.remove never throws, so a
    // storage hiccup leaves an orphan file rather than a photo the business
    // cannot get rid of.
    await this.prisma.locationMedia.delete({ where: { id: mediaId } });
    await this.storage.remove(media.url);

    return { message: 'Photo deleted.' };
  }
}
