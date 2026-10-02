import { IsBoolean } from 'class-validator';

export class SetCategoryLiveDto {
  @IsBoolean()
  isLive!: boolean;
}
