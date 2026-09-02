import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { TicketCategory } from '@prisma/client';

export class CreateTicketDto {
  @IsEnum(TicketCategory, {
    message: `category must be one of: ${Object.values(TicketCategory).join(', ')}`,
  })
  category!: TicketCategory;

  @IsString()
  @Length(3, 200)
  subject!: string;

  /** The opening message. A ticket with no description is not actionable. */
  @IsString()
  @Length(1, 5000)
  body!: string;

  /**
   * Optional. When present the reporter is verified to be a party to it —
   * in the service, not only in a guard.
   *
   * Note reporterType is NOT accepted here: it is derived from the
   * authenticated user's role, so a customer cannot file as a business.
   */
  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}
