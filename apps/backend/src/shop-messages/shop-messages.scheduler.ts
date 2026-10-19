import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShopMessagesService } from './shop-messages.service';

@Injectable()
export class ShopMessagesScheduler {
  constructor(private readonly shopMessages: ShopMessagesService) {}

  /**
   * A new discount at a shop you follow, noted in the app (§288) — in the
   * list only, never as an alert or email: that is what the yes to offers is for.
   */
  @Cron('0 */15 * * * *', { name: 'followed-shop-discounts' })
  discounts() {
    return this.shopMessages.tellFollowersOfDiscounts();
  }
}
