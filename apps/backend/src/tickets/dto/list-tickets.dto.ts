import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { TicketCategory, TicketStatus } from '@prisma/client';

export class ListTicketsDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

/** Admins can additionally narrow by who a ticket is assigned to. */
export class ListAdminTicketsDto extends ListTicketsDto {
  @IsOptional()
  @IsUUID()
  assignedAdminId?: string;

  /**
   * A word to find a ticket by (§247): its reference, its subject, the
   * reporter's email or the business's name, any case — searched by the
   * database.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** One person's requests — to choose the one a support action answers (§297). */
  @IsOptional()
  @IsUUID()
  reporterId?: string;

  /** One shop's requests. */
  @IsOptional()
  @IsUUID()
  businessId?: string;

  /** 'true' leaves out the resolved and closed — the ones still being dealt with. */
  @IsOptional()
  @IsString()
  open?: string;
}
