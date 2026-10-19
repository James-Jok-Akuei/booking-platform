import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { TicketCategory } from '@prisma/client';

/**
 * An administrator starting a conversation with one person (§287) — as a
 * support ticket, so the person can reply and both sides keep the record.
 */
export class StartTicketDto {
  /** The customer or seller to write to. */
  @IsUUID()
  userId!: string;

  @IsString()
  @Length(3, 200)
  subject!: string;

  /** The first message, from the administrator. */
  @IsString()
  @Length(1, 5000)
  body!: string;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}

export class StartedTicketDto {
  id!: string;
  reference!: string;
}
