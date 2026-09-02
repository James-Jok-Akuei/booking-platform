import { IsString, Length } from 'class-validator';

export class ReviewResponseDto {
  @IsString()
  @Length(1, 2000)
  responseText!: string;
}
