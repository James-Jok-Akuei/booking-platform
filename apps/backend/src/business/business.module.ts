import { Module } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { AdminBusinessController } from './admin-business.controller';
import { BusinessModerationService } from './business-moderation.service';
import { BusinessAccessService } from './business-access.service';
import { BusinessProfileService } from './business-profile.service';
import { LocationsService } from './locations.service';
import { ServicesService } from './services.service';
import { GalleryService } from './gallery.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { BusinessRolesGuard } from './guards/business-roles.guard';

// PrismaModule, AuthModule (guards) and StorageModule are all @Global(),
// so none of them need importing here.
@Module({
  controllers: [BusinessController, AdminBusinessController, MembersController],
  providers: [
    BusinessModerationService,
    BusinessAccessService,
    BusinessProfileService,
    LocationsService,
    ServicesService,
    GalleryService,
    MembersService,
    BusinessRolesGuard,
  ],
  // Exported so AvailabilityModule reuses the exact same ownership check
  // rather than growing a second, drifting copy of it.
  // BusinessRolesGuard is exported alongside the access service because
  // AvailabilityModule's schedule controller uses the same guard.
  exports: [BusinessAccessService, BusinessRolesGuard],
})
export class BusinessModule {}
