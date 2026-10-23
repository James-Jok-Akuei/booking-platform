import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { RatesService } from './rates.service';
import { BusinessTodayController, PublicTodayController } from './today.controller';
import { TodayScheduler } from './today.scheduler';
import { TodayService } from './today.service';
import { WeatherService } from './weather.service';

/** "Rwanda today" (§310): the calendar, mobile money's health, searches, weather, rates and our team's news. */
@Module({
  imports: [BusinessModule],
  controllers: [BusinessTodayController, PublicTodayController],
  providers: [TodayService, TodayScheduler, WeatherService, RatesService],
})
export class TodayModule {}
