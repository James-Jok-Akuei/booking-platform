import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AccountController } from './account.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { AccountService } from './account.service';

// NotificationsService is @Global(), so nothing needs importing for it.
@Module({
  controllers: [UsersController, AccountController, AdminUsersController],
  providers: [UsersService, AdminInvitationsService, AccountService],
  exports: [UsersService, AccountService],
})
export class UsersModule {}
