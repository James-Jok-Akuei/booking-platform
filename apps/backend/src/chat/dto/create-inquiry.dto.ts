import { IsUUID } from 'class-validator';

export class CreateInquiryThreadDto {
  @IsUUID()
  businessProfileId!: string;
}
