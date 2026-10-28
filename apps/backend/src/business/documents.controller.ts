import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCreatedResponse, ApiOkResponse, ApiProduces } from '@nestjs/swagger';
import { BusinessMemberRole, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AllBranches, BusinessRoles } from '../common/decorators/business-roles.decorator';
import { BusinessContext, CurrentBusiness } from '../common/decorators/current-business.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { BusinessRolesGuard } from './guards/business-roles.guard';
import { MulterExceptionFilter } from './filters/multer-exception.filter';
import { DOCUMENT_EXTENSIONS_LABEL, DOCUMENT_MIME_TYPES } from '../storage/storage.service';
import { makeUploadOptions } from '../storage/upload-options';
import { DocumentsService } from './documents.service';
import { BusinessDocumentDto, BusinessDocumentsDto, RefuseDocumentDto, UploadDocumentDto } from './dto/documents.dto';

const documentUploadOptions = makeUploadOptions(DOCUMENT_MIME_TYPES, DOCUMENT_EXTENSIONS_LABEL);

/** How the contract describes the file routes: bytes of the paper's own type. */
const FILE_RESPONSE = {
  description: 'The paper itself — a PDF or an image, as uploaded.',
  content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
} as const;

/** The file itself, shown in the browser, never cached beyond this request. */
function sendFile(res: Response, file: { buffer: Buffer; mimeType: string; fileName: string }) {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/["\r\n]/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.buffer);
}

/**
 * A shop's business papers (§314): the owner's and every-branch managers'
 * alone — staff and branch managers neither see nor add them.
 */
@Controller('business/documents')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
@BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
@AllBranches()
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class BusinessDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ApiOkResponse({ type: BusinessDocumentsDto })
  list(@CurrentBusiness() business: BusinessContext) {
    return this.documents.list(business.businessId);
  }

  @Post()
  @ApiCreatedResponse({ type: BusinessDocumentDto })
  @UseInterceptors(FileInterceptor('file', documentUploadOptions))
  @UseFilters(new MulterExceptionFilter({ maxFiles: 1, field: 'file', noun: 'paper' }))
  upload(
    @CurrentBusiness() business: BusinessContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.documents.upload(business.businessId, user.userId, dto, file);
  }

  @Delete(':id')
  @ApiOkResponse({ type: BusinessDocumentsDto })
  remove(@CurrentBusiness() business: BusinessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(business.businessId, id);
  }

  @Get(':id/file')
  @ApiProduces('application/octet-stream')
  @ApiOkResponse(FILE_RESPONSE)
  async file(@CurrentBusiness() business: BusinessContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.documents.file(business.businessId, id));
  }
}

/** The same papers, for our team: open, check, or refuse with a reason (§314). */
@Controller('admin/businesses/:businessId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ApiOkResponse({ type: BusinessDocumentsDto })
  list(@CurrentUser() user: AuthenticatedUser, @Param('businessId', ParseUUIDPipe) businessId: string) {
    return this.documents.listForAdmin(user, businessId);
  }

  @Patch(':id/verify')
  @ApiOkResponse({ type: BusinessDocumentDto })
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documents.verify(user, businessId, id);
  }

  @Patch(':id/refuse')
  @ApiOkResponse({ type: BusinessDocumentDto })
  refuse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefuseDocumentDto,
  ) {
    return this.documents.refuse(user, businessId, id, dto.reason);
  }

  @Get(':id/file')
  @ApiProduces('application/octet-stream')
  @ApiOkResponse(FILE_RESPONSE)
  async file(
    @CurrentUser() user: AuthenticatedUser,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.documents.fileForAdmin(user, businessId, id));
  }
}
