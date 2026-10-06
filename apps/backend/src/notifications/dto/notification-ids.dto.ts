import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** A handful of notifications to act on together (§162). */
export class NotificationIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}
