import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  /**
   * Optional, because a photo alone is a valid message. The service rejects
   * the case where neither this nor a file is present — a rule the database
   * also enforces via the messages_content_not_empty CHECK.
   *
   * Arrives as a multipart text field.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'A message can be at most 2000 characters.' })
  body?: string;
}
