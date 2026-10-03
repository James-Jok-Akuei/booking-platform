import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccountService } from './account.service';
import { SavedNumbersService } from './saved-numbers.service';
import { SaveNumberDto } from './dto/saved-number.dto';
import { galleryUploadOptions } from '../business/gallery-upload.options';
import { MulterExceptionFilter } from '../business/filters/multer-exception.filter';

/**
 * What a person may do to their OWN account (§119).
 *
 * Every route here acts on the caller and takes no id, so there is nothing to
 * tamper with and no authorisation question beyond being signed in. That is why
 * these are not on the admin controller beside the moderation actions, which
 * take an id and are a different kind of power entirely.
 */
@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly numbers: SavedNumbersService,
  ) {}

  /**
   * This person's picture (§124.1). `galleryUploadOptions` because it IS an
   * image — the same allow-list a shop photo gets, and deliberately not §81's
   * wider ticket-attachment list.
   */
  @Post('image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', galleryUploadOptions))
  @UseFilters(new MulterExceptionFilter({ maxFiles: 1, field: 'file', noun: 'image' }))
  setImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.account.setImage(user.userId, file);
  }

  @Delete('image')
  @HttpCode(HttpStatus.OK)
  removeImage(@CurrentUser() user: AuthenticatedUser) {
    return this.account.removeImage(user.userId);
  }

  // ---------- Numbers they pay from (§124.2) ----------
  //
  // A keyboard shortcut, not a payment method: nothing here can be charged
  // without the person holding the handset.

  @Get('payment-numbers')
  listNumbers(@CurrentUser() user: AuthenticatedUser) {
    return this.numbers.list(user.userId);
  }

  @Post('payment-numbers')
  @HttpCode(HttpStatus.OK)
  saveNumber(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveNumberDto,
  ) {
    return this.numbers.save(user.userId, dto);
  }

  @Delete('payment-numbers/:id')
  @HttpCode(HttpStatus.OK)
  removeNumber(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.numbers.remove(user.userId, id);
  }

  /** Everything the platform holds about the caller, as JSON (§119.2). */
  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser) {
    return this.account.exportFor(user.userId);
  }

  /**
   * Closes the caller's own account (§119.1).
   *
   * POST rather than DELETE, and the name says why: nothing is deleted. The row
   * stays so that bookings, reviews and the ledger entries that depend on them
   * survive; the identity on it does not.
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentUser() user: AuthenticatedUser) {
    return this.account.close(user.userId);
  }
}
