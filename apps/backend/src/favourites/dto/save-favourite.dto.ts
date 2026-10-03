import { IsUUID } from 'class-validator';

export class SaveFavouriteDto {
  @IsUUID()
  locationId!: string;
}
