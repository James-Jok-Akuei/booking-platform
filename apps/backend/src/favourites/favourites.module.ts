import { Module } from '@nestjs/common';
import { FavouritesController } from './favourites.controller';
import { FavouritesService } from './favourites.service';

@Module({
  controllers: [FavouritesController],
  providers: [FavouritesService],
  // Discovery marks each result as saved or not, so it needs this too.
  exports: [FavouritesService],
})
export class FavouritesModule {}
