import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { LOCALES } from '../../i18n/locales';
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

  /** The language it was read in, kept with the agreement (§308.5). */
  @IsOptional()
  @IsIn(LOCALES)
  language?: (typeof LOCALES)[number];
}

/** "Read the English": a document in a language other than the app's (§308.5). */
export class LegalLanguageQueryDto {
  @IsOptional()
  @IsIn(LOCALES)
  lang?: (typeof LOCALES)[number];
}

/** One version in one other language. A language without a body is not offered. */
export class LegalWordsDto {
  @IsOptional()
  @IsString()
  @Length(0, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200_000)
  body?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  changeNote?: string;
}

export class LegalTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LegalWordsDto)
  rw?: LegalWordsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LegalWordsDto)
  fr?: LegalWordsDto;
}
