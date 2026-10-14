import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Which branches someone looks after (§277): every branch — including ones
 * added later — or the ones listed. At least one when not every branch;
 * the service checks they are this business's open branches.
 */
export class MemberBranchesDto {
  @IsBoolean()
  allLocations!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}
