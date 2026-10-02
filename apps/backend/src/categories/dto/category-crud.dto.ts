import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

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
}

export class CreateSubcategoryDto {
  @IsString()
  @Length(2, 60)
  name!: string;
}

export class UpdateSubcategoryDto {
  @IsString()
  @Length(2, 60)
  name!: string;
}
