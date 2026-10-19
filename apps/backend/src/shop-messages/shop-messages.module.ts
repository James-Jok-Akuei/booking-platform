import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { BusinessShopMessagesController, FollowsController } from './shop-messages.controller';
import { ShopMessagesService } from './shop-messages.service';

/** Customers following shops, and shops writing to them (§287). */
@Module({
  imports: [BusinessModule],
  controllers: [FollowsController, BusinessShopMessagesController],
  providers: [ShopMessagesService],
})
export class ShopMessagesModule {}
