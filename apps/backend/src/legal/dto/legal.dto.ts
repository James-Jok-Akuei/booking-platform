import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { LegalDocumentKind } from '@prisma/client';

export class StartDraftDto {
  @IsEnum(LegalDocumentKind, {
    message: `kind must be one of: ${Object.values(LegalDocumentKind).join(', ')}`,
  })
  kind!: LegalDocumentKind;
}

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  title?: string;

  /**
   * The document. Long on purpose: a privacy policy that has to fit in a tweet
   * is not a privacy policy, and truncating one at save time would be the worst
   * possible place to discover a limit.
   */
  @IsOptional()
  @IsString()
  @Length(0, 200_000)
  body?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  changeNote?: string;
}

export class AcceptDocumentDto {
  @IsUUID()
  documentId!: string;
}
