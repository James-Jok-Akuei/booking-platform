import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { AdminPlacesController } from './admin-places.controller';

@Module({ controllers: [PlacesController, AdminPlacesController] })
export class PlacesModule {}
