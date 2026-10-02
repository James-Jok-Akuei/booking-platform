import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { AdminCategoriesController } from './admin-categories.controller';

@Module({
  controllers: [CategoriesController, AdminCategoriesController],
})
export class CategoriesModule {}
