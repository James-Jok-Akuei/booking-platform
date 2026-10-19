import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { BusinessShopMessagesController, FollowsController } from './shop-messages.controller';
import { ShopMessagesService } from './shop-messages.service';
import { ShopMessagesScheduler } from './shop-messages.scheduler';

/** Customers following shops, and shops writing to them (§287, §288). */
@Module({
  imports: [BusinessModule],
  controllers: [FollowsController, BusinessShopMessagesController],
  providers: [ShopMessagesService, ShopMessagesScheduler],
  exports: [ShopMessagesService],
})
export class ShopMessagesModule {}
