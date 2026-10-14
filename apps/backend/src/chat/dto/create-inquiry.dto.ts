import { IsOptional, IsUUID } from 'class-validator';

export class CreateInquiryThreadDto {
  @IsUUID()
  businessProfileId!: string;

  /**
   * The branch whose page the question is asked from (§277), so the people who
   * look after that branch see it. Optional: without it, the question goes to
   * those who look after every branch.
   */
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
