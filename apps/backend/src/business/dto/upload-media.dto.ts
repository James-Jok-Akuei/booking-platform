import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class UploadMediaDto {
  // Arrives as a multipart text field, so it needs an explicit transform —
  // the global ValidationPipe's implicit conversion does not apply to
  // multipart/form-data bodies.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
