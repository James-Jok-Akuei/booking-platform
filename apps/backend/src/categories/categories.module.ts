import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CategoriesController } from './categories.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { TaxonomyNamesService } from './taxonomy-names.service';
import { LocalisedNamesInterceptor } from './localised-names.interceptor';

@Global()
@Module({
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [
    TaxonomyNamesService,
    // Names in the reader's language on every answer (§308.3).
    { provide: APP_INTERCEPTOR, useClass: LocalisedNamesInterceptor },
  ],
  exports: [TaxonomyNamesService],
})
export class CategoriesModule {}
