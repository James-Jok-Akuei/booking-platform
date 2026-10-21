import { Type } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';

/** A name — and for a category, its description — in one other language (§308.3). Empty means not typed. */
export class LanguageWordsDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/** The words in Kinyarwanda and in French, as the console's boxes hold them. */
export class TaxonomyTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LanguageWordsDto)
  rw?: LanguageWordsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LanguageWordsDto)
  fr?: LanguageWordsDto;
}

export class CreateCategoryDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  /** An icon key or emoji for the frontends, never a URL. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TaxonomyTranslationsDto)
  translations?: TaxonomyTranslationsDto;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TaxonomyTranslationsDto)
  translations?: TaxonomyTranslationsDto;
}

export class CreateSubcategoryDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TaxonomyTranslationsDto)
  translations?: TaxonomyTranslationsDto;
}

export class UpdateSubcategoryDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TaxonomyTranslationsDto)
  translations?: TaxonomyTranslationsDto;
}

/**
 * A write-in many shops share under "Other", made a type of its own (§267).
 * `label` is the write-in as shops wrote it (matched without regard to case);
 * `name` is the type's name, if it should read differently.
 */
export class PromoteWriteInDto {
  @IsString()
  @Length(2, 40)
  label!: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;
}
