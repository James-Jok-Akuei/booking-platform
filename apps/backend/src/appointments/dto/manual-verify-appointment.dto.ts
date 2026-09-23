import { IsString, Length } from 'class-validator';

/**
 * Verifying an arrival when the code path cannot be used at all (§54.3).
 *
 * One field, and it is an attestation rather than an answer: the business
 * records what the customer recalled — the booking reference, the service they
 * came for, when they booked, whatever actually identified them — and that text
 * is stored verbatim and shown to admins.
 *
 * A minimum length, because "ok" is not a record of anything and this note is
 * the only artefact the review depends on. A maximum because it is free text on
 * an endpoint, and unbounded text on an endpoint is a storage bug waiting to
 * happen.
 */
export class ManualVerifyAppointmentDto {
  @IsString()
  @Length(10, 500, {
    message:
      'note must say what the customer recalled (10-500 characters). It is recorded and reviewed by support.',
  })
  note!: string;
}
