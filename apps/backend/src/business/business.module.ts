import { Module } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { AdminBusinessController } from './admin-business.controller';
import { BusinessModerationService } from './business-moderation.service';
import { BusinessAccessService } from './business-access.service';
import { BusinessProfileService } from './business-profile.service';
import { LocationsService } from './locations.service';
import { ServicesService } from './services.service';
import { GalleryService } from './gallery.service';
import { ServiceDraftsService } from './service-drafts.service';
// Pausing a shop is the business-side half of §119, and the rule lives with
// account closure rather than being written twice.
import { UsersModule } from '../users/users.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { BusinessRolesGuard } from './guards/business-roles.guard';

// PrismaModule, AuthModule (guards) and StorageModule are all @Global(),
// so none of them need importing here.
@Module({
  imports: [UsersModule],
  controllers: [BusinessController, AdminBusinessController, MembersController],
  providers: [
    BusinessModerationService,
    BusinessAccessService,
    BusinessProfileService,
    LocationsService,
    ServicesService,
    GalleryService,
    ServiceDraftsService,
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
