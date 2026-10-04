import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  ParseEnumPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LegalDocumentKind, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { LegalService } from './legal.service';
import {
  AdminLegalDocumentDto,
  LegalDraftDto,
} from './dto/legal-response.dto';
import {
  LegalAcceptanceDto,
  LegalDocumentDto,
  LegalStatusDto,
} from './dto/legal-response.dto';
import {
  AcceptDocumentDto,
  StartDraftDto,
  UpdateDraftDto,
} from './dto/legal.dto';

/**
 * The published documents, readable by anyone (§122).
 *
 * No guard at all. Somebody deciding whether to sign up has to be able to read
 * the terms first, and making them agree before they can read is the thing
 * everybody complains about — it is also the one thing that would make the
 * agreement worth nothing.
 */
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  @ApiOkResponse({ type: [LegalDocumentDto] })
  published() {
    return this.legal.published();
  }

  /**
   * One document by kind.
   *
   * `ParseEnumPipe` is not decoration. Without it, anything in this position
   * reached Prisma as a `kind` it could not parse and came back a **500** —
   * which is how `GET /legal/me` behaved before the controllers were ordered,
   * since `me` matches `:kind` perfectly well. The pipe makes any such collision
   * a clean 400 naming the three valid values, rather than an internal error
   * that says nothing.
   */
  @Get(':kind')
  @ApiOkResponse({ type: LegalDocumentDto })
  current(
    @Param('kind', new ParseEnumPipe(LegalDocumentKind)) kind: LegalDocumentKind,
  ) {
    return this.legal.currentOf(kind);
  }
}

/** What this person has agreed to, and agreeing to it. */
@Controller('legal/me')
@UseGuards(JwtAuthGuard)
export class LegalAcceptanceController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  @ApiOkResponse({ type: [LegalStatusDto] })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.legal.statusFor(user.userId);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LegalAcceptanceDto })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptDocumentDto,
  ) {
    return this.legal.accept(user.userId, dto.documentId);
  }
}

/**
 * Writing them (§122).
 *
 * A published version is never edited, only superseded — so the only mutable
 * thing here is a draft, and there is at most one per kind.
 */
@Controller('admin/legal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  @ApiOkResponse({ type: AdminLegalDocumentDto, isArray: true })
  list() {
    return this.legal.listForAdmin();
  }

  @Post('drafts')
  @ApiCreatedResponse({ type: LegalDraftDto })
  @HttpCode(HttpStatus.OK)
  startDraft(@Body() dto: StartDraftDto) {
    return this.legal.startDraft(dto.kind);
  }

  @Patch('drafts/:id')
  @ApiOkResponse({ type: LegalDraftDto })
  updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.legal.updateDraft(id, dto);
  }

  @Post('drafts/:id/publish')
  @ApiOkResponse({ type: LegalDocumentDto })
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.legal.publish(id, user.userId);
  }
}
