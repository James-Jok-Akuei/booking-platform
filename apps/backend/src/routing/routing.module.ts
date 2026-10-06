import { Module } from '@nestjs/common';
import { AddressSearchController } from './address-search.controller';
import { AddressSearchService } from './address-search.service';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';

/** Road distance and driving time to one branch (§157), and finding a typed address (§172). */
@Module({
  controllers: [RoutingController, AddressSearchController],
  providers: [RoutingService, AddressSearchService],
  exports: [RoutingService],
})
export class RoutingModule {}
