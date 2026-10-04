import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BusinessMemberRole, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BusinessRoles } from '../common/decorators/business-roles.decorator';
import {
  BusinessContext,
  CurrentBusiness,
} from '../common/decorators/current-business.decorator';
import { BusinessRolesGuard } from './guards/business-roles.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { BusinessProfileService } from './business-profile.service';
import { AccountService } from '../users/account.service';
import { ServiceDraftsService } from './service-drafts.service';
import { UpdateServiceDraftDto } from './dto/service-draft.dto';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import {
  BusinessLocationDto,
  BusinessProfileDto,
  BusinessServiceDto,
  LocationHoursDto,
} from './dto/business-response.dto';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import {
  ServiceImageDto,
  ServiceImagesDto,
  BusinessPauseStateDto,
  DeactivatedServiceDto,
  GalleryDto,
  GalleryPhotoDto,
  LocationCapacityDto,
  ServiceDraftDto,
  ServiceOfferedResultDto,
} from './dto/business-write-response.dto';
import { LocationsService } from './locations.service';
import { ServicesService } from './services.service';
import { GalleryService } from './gallery.service';
import { ServiceImagesService } from './service-images.service';
import { galleryUploadOptions } from './gallery-upload.options';
import { MulterExceptionFilter } from './filters/multer-exception.filter';
import { UpdateBusinessProfileDto } from './dto/update-profile.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateLocationCapacityDto } from './dto/update-capacity.dto';
import { SetLocationHoursDto } from './dto/set-hours.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { SetServiceOfferedDto } from './dto/set-service-offered.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

/**
 * Everything a business manages about itself: profile, locations, opening
 * hours, service catalogue and per-location photo gallery.
 *
 * Guarded four deep. JwtAuthGuard establishes *who* is calling; RolesGuard +
 * @Roles(BUSINESS) establishes that they hold a business account;
 * BusinessRolesGuard + @BusinessRoles(...) establishes what they may do inside
 * their business; and ownership is still enforced per-resource inside the
 * services via BusinessAccessService, which scopes every query to the caller's
 * own businessId. A business can never reach another business's data.
 *
 * The role split: OWNER and MANAGER may write. STAFF may read everything and
 * write nothing — their real purpose is managing bookings, which does not
 * exist until the Appointment module, so their permissions are deliberately
 * narrow for now rather than guessed at.
 *
 * NOTE — approval status: a PENDING business may use every endpoint here.
 * Onboarding has to be completable *before* an admin reviews it, otherwise
 * there is nothing for the admin to review. Status gates public visibility, not
 * editing: PENDING, REJECTED and SUSPENDED businesses must be excluded from
 * customer-facing search and discovery. That filter is not implemented here
 * because no public discovery endpoint exists yet — it belongs to the customer
 * search/discovery module.
 */
@Controller('business')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class BusinessController {
  constructor(
    private readonly profiles: BusinessProfileService,
    private readonly locations: LocationsService,
    private readonly services: ServicesService,
    private readonly gallery: GalleryService,
    private readonly serviceImages: ServiceImagesService,
    private readonly account: AccountService,
    private readonly drafts: ServiceDraftsService,
  ) {}

  // ---------- Profile ----------

  @Get('profile')
  @ApiOkResponse({ type: BusinessProfileDto })
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  getProfile(@CurrentBusiness() business: BusinessContext) {
    return this.profiles.findOwn(business.businessId);
  }

  @Patch('profile')
  @ApiOkResponse({ type: BusinessProfileDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  updateProfile(
    @CurrentBusiness() business: BusinessContext,
    @Body() dto: UpdateBusinessProfileDto,
  ) {
    return this.profiles.update(business.businessId, dto);
  }

  /**
   * Pause the whole shop (§119.3). OWNER only — it takes every branch out of
   * search at once, which is the business's most consequential self-service act.
   *
   * Not a status change: `status: SUSPENDED` is what an admin does to a business
   * and comes with a reason the business is told. A holiday and a sanction must
   * not look the same in an admin listing.
   */
  @Post('pause')
  @ApiOkResponse({ type: BusinessPauseStateDto })
  @HttpCode(HttpStatus.OK)
  @BusinessRoles(BusinessMemberRole.OWNER)
  pause(@CurrentBusiness() business: BusinessContext) {
    return this.account.setPaused(business.businessId, true);
  }

  @Post('resume')
  @ApiOkResponse({ type: BusinessPauseStateDto })
  @HttpCode(HttpStatus.OK)
  @BusinessRoles(BusinessMemberRole.OWNER)
  resume(@CurrentBusiness() business: BusinessContext) {
    return this.account.setPaused(business.businessId, false);
  }

  // ---------- Service drafts (§123) ----------
  //
  // Open to everyone who can create a service. A draft is a half-written one, so
  // the same people who may finish it may start it.

  @Get('service-drafts')
  @ApiOkResponse({ type: ServiceDraftDto, isArray: true })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  listServiceDrafts(@CurrentUser() user: AuthenticatedUser) {
    return this.drafts.list(user.userId);
  }

  @Post('service-drafts')
  @ApiCreatedResponse({ type: ServiceDraftDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  createServiceDraft(@CurrentUser() user: AuthenticatedUser) {
    return this.drafts.create(user.userId);
  }

  @Patch('service-drafts/:id')
  @ApiOkResponse({ type: ServiceDraftDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  updateServiceDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDraftDto,
  ) {
    return this.drafts.update(user.userId, id, dto);
  }

  @Delete('service-drafts/:id')
  @ApiOkResponse({ type: ActionMessageDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  discardServiceDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.drafts.discard(user.userId, id);
  }

  // ---------- Locations ----------

  @Post('locations')
  @ApiCreatedResponse({ type: BusinessLocationDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  createLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locations.create(user.userId, dto);
  }

  @Get('locations')
  @ApiOkResponse({ type: [BusinessLocationDto] })
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  listLocations(@CurrentUser() user: AuthenticatedUser) {
    return this.locations.findAll(user.userId);
  }

  @Patch('locations/:id')
  @ApiOkResponse({ type: BusinessLocationDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(user.userId, id, dto);
  }

  /**
   * Closes a branch (§89). Kept as DELETE because that is the verb a client
   * reaches for, but it is a soft close: nothing that happened there is lost,
   * and `reopen` puts it back.
   */
  @Delete('locations/:id')
  @ApiOkResponse({ type: ActionMessageDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  closeLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.locations.close(user.userId, id);
  }

  @Patch('locations/:id/reopen')
  @ApiOkResponse({ type: ActionMessageDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  reopenLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.locations.reopen(user.userId, id);
  }

  /** Sets concurrent-appointment capacity. See LocationsService.setCapacity. */
  @Patch('locations/:id/capacity')
  @ApiOkResponse({ type: LocationCapacityDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  updateLocationCapacity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationCapacityDto,
  ) {
    return this.locations.setCapacity(user.userId, id, dto.capacity);
  }

  /** Replaces the location's whole week of operating hours in one call. */
  @Post('locations/:id/hours')
  @ApiOkResponse({ type: LocationHoursDto, isArray: true })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  setLocationHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetLocationHoursDto,
  ) {
    return this.locations.setHours(user.userId, id, dto);
  }

  /**
   * The logo and cover image (§88).
   *
   * One route with the kind in the path rather than two near-identical ones;
   * they differ only in which column is written. `galleryUploadOptions`
   * because these ARE shop-window images — the same rule the gallery has, and
   * deliberately not the wider ticket list from §81.
   */
  @Post('profile/image/:kind')
  @ApiCreatedResponse({ type: BusinessProfileDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  @UseInterceptors(FileInterceptor('file', galleryUploadOptions))
  @UseFilters(new MulterExceptionFilter({ maxFiles: 1, field: 'file', noun: 'image' }))
  setProfileImage(
    @CurrentBusiness() business: BusinessContext,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (kind !== 'logo' && kind !== 'cover') {
      throw new BadRequestException('Image kind must be "logo" or "cover".');
    }
    return this.profiles.setImage(business.businessId, kind, file);
  }

  // ---------- Gallery ----------
  // Declared before the generic locations routes would matter; Nest matches on
  // the full path so `locations/:id/gallery` and `locations/:id` never collide.

  @Post('locations/:id/gallery')
  @ApiCreatedResponse({ type: GalleryPhotoDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  @UseInterceptors(FileInterceptor('file', galleryUploadOptions))
  // renders the 15MB trip as a clear 400. An instance, not the class: a
  // class reference makes Nest try to DI the constructor argument.
  @UseFilters(new MulterExceptionFilter({ maxFiles: 1, field: 'file', noun: 'photo' }))
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
  ) {
    return this.gallery.upload(user.userId, id, file, dto.displayOrder);
  }

  @Get('locations/:id/gallery')
  @ApiOkResponse({ type: GalleryDto })
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  listGallery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.gallery.list(user.userId, id);
  }

  @Delete('locations/:id/gallery/:mediaId')
  @ApiOkResponse({ type: ActionMessageDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  deletePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.gallery.remove(user.userId, id, mediaId);
  }

  // ---------- Services ----------

  @Post('services')
  @ApiCreatedResponse({ type: BusinessServiceDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  createService(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateServiceDto,
  ) {
    return this.services.create(user.userId, dto);
  }

  @Get('services')
  @ApiOkResponse({ type: [BusinessServiceDto] })
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  listServices(@CurrentUser() user: AuthenticatedUser) {
    return this.services.findAll(user.userId);
  }

  @Patch('services/:id')
  @ApiOkResponse({ type: BusinessServiceDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  updateService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(user.userId, id, dto);
  }

  /**
   * Turns a service on or off at ONE branch (§74).
   *
   * A PATCH, not a DELETE: the offer row and its price survive a pause. A
   * separate decision from retiring below — "not here, for now" rather than
   * "we have stopped doing this at all".
   */
  @Patch('services/:id/locations/:locationId')
  @ApiOkResponse({ type: ServiceOfferedResultDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  setServiceOfferedAtLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: SetServiceOfferedDto,
  ) {
    return this.services.setOfferedAtLocation(user.userId, id, locationId, dto.isOffered);
  }

  /**
   * Turns a service on or off at EVERY branch (§76).
   *
   * The bulk form of the route above. Declared before `services/:id` so the
   * more specific path wins.
   */
  @Patch('services/:id/offered')
  @ApiOkResponse({ type: ServiceOfferedResultDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  setServiceOfferedEverywhere(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetServiceOfferedDto,
  ) {
    return this.services.setOfferedEverywhere(user.userId, id, dto.isOffered);
  }

  /**
   * Retires a service EVERYWHERE. Soft delete: flips isActive to false so past
   * appointments still resolve.
   */
  @Delete('services/:id')
  @ApiOkResponse({ type: DeactivatedServiceDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  deleteService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.deactivate(user.userId, id);
  }
  // ---------- Photos of a service (§132) ----------
  //
  // Separate from service creation, not part of it: creating a service is one
  // JSON request and a photo is multipart, so one endpoint would have to be
  // both. The business app creates the service, then uploads — the same two
  // steps the location gallery already uses.

  /**
   * One photo, up to eleven per service.
   *
   * `galleryUploadOptions` because these ARE shop-window images — the same
   * allow-list a branch photo gets, and deliberately not §81's wider
   * ticket-attachment list.
   */
  @Post('services/:id/images')
  @ApiCreatedResponse({ type: ServiceImageDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  @UseInterceptors(FileInterceptor('file', galleryUploadOptions))
  @UseFilters(new MulterExceptionFilter({ maxFiles: 1, field: 'file', noun: 'image' }))
  uploadServiceImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
  ) {
    return this.serviceImages.upload(user.userId, id, file, dto.displayOrder);
  }

  @Get('services/:id/images')
  @ApiOkResponse({ type: ServiceImagesDto })
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  listServiceImages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceImages.list(user.userId, id);
  }

  @Delete('services/:id/images/:imageId')
  @ApiOkResponse({ type: ActionMessageDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  deleteServiceImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.serviceImages.remove(user.userId, id, imageId);
  }
}
