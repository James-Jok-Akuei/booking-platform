import { Module } from '@nestjs/common';
// Pausing a shop and closing an account follow the shop's and the person's own rules (§119).
import { UsersModule } from '../users/users.module';
import { SupportAccountsController } from './support-accounts.controller';
import { SupportAccountsService } from './support-accounts.service';

/**
 * Support acting for a shop or a person (§297). The log itself is global
 * (SupportLogModule), since bookings and help requests write to it as well.
 */
@Module({
  imports: [UsersModule],
  controllers: [SupportAccountsController],
  providers: [SupportAccountsService],
})
export class SupportModule {}
