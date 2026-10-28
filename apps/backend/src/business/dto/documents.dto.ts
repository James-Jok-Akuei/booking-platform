import { ApiProperty } from '@nestjs/swagger';
import { BusinessDocumentKind, BusinessDocumentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/** The fields sent beside the file (§314). Strings: they arrive as multipart. */
export class UploadDocumentDto {
  @IsEnum(BusinessDocumentKind)
  kind!: BusinessDocumentKind;

  /** What it is, when the kind is OTHER. */
  @IsOptional()
  @IsString()
  @Length(3, 80)
  label?: string;

  /** The number on it, as typed. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  number?: string;

  /** When it runs out, "YYYY-MM-DD". */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expiresAt is a day, YYYY-MM-DD.' })
  expiresAt?: string;
}

export class RefuseDocumentDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** One business paper, as the shop and our team see it (§314). The file itself is behind its own route. */
export class BusinessDocumentDto {
  id!: string;
  kind!: BusinessDocumentKind;
  label!: string | null;
  number!: string | null;
  expiresAt!: string | null;
  fileName!: string;
  mimeType!: string;
  sizeBytes!: number;
  status!: BusinessDocumentStatus;
  refusalReason!: string | null;
  checkedAt!: string | null;
  createdAt!: string;
  /** Past its end date. */
  expired!: boolean;
  /** Who uploaded it — for our team; the shop sees its own people's emails anyway. */
  uploadedBy!: string;
}

/** One licence a kind of shop must hold (§314): any of `kinds`, checked. */
export class PaperRuleDto {
  @ApiProperty({ enum: ['health', 'veterinary', 'tourism', 'legal'] })
  key!: 'health' | 'veterinary' | 'tourism' | 'legal';
  @ApiProperty({ enum: BusinessDocumentKind, isArray: true })
  kinds!: BusinessDocumentKind[];
  @ApiProperty({ enum: ['checked', 'waiting', 'missing'] })
  state!: 'checked' | 'waiting' | 'missing';
}

export class BusinessDocumentsDto {
  /** A registration paper checked by our team, still standing: the mark customers see. */
  registered!: boolean;
  /** The licences this kind of shop must hold, and where it stands on each. */
  required!: PaperRuleDto[];
  /** Every paper not yet replaced, newest first. */
  documents!: BusinessDocumentDto[];
  /** Whether papers can be kept here at all (private storage set up). */
  canUpload!: boolean;
}
