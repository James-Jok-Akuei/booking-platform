import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AccountController } from './account.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { AccountService } from './account.service';
import { SavedNumbersService } from './saved-numbers.service';
// A profile picture is an upload (§124.1).
import { StorageModule } from '../storage/storage.module';

// NotificationsService is @Global(), so nothing needs importing for it.
@Module({
  imports: [StorageModule],
  controllers: [UsersController, AccountController, AdminUsersController],
  providers: [UsersService, AdminInvitationsService, AccountService, SavedNumbersService],
  exports: [UsersService, AccountService, SavedNumbersService],
})
export class UsersModule {}
