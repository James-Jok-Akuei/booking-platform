import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

/** The words under a story's photo, and the branch it is about (§285). Sent beside the file. */
export class PostStoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  caption?: string;

  /** Left out: the whole shop. Required of someone who looks after some branches only. */
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

/** Why a customer thinks a story should not be there. */
export class ReportStoryDto {
  @IsString()
  @Length(3, 300)
  reason!: string;
}

/** Why an administrator took a story down; the shop is told it. */
export class RemoveStoryDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
