import { Module } from '@nestjs/common';
import {
  AdminLegalController,
  LegalAcceptanceController,
  LegalController,
} from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  /**
   * ORDER MATTERS. Nest matches routes in registration order, and `/legal/:kind`
   * matches `/legal/me` perfectly well — so the specific path has to be
   * registered first or it is unreachable (§122.2). The `ParseEnumPipe` on
   * `:kind` is the second half of that fix: it turns any future collision into a
   * 400 that names the problem, instead of a 500 from the database.
   */
  controllers: [LegalAcceptanceController, LegalController, AdminLegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
