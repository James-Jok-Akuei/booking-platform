import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { OffersPreferenceDto, UpdateOffersPreferenceDto } from './dto/offers.dto';
import { OffersService } from './offers.service';

/** The caller's own choice about emails near them (§140). */
@Controller('users/me/offers')
@UseGuards(JwtAuthGuard)
@ApiErrors({ auth: true, validation: true, notFound: true })
export class OffersPreferenceController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @ApiOkResponse({ type: OffersPreferenceDto })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.preference(user.userId);
  }

  @Patch()
  @ApiOkResponse({ type: OffersPreferenceDto })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOffersPreferenceDto) {
    return this.offers.update(user.userId, dto);
  }
}

/**
 * The link at the bottom of every offers email.
 *
 * Not in the API contract: it is opened by a person in a browser, from an
 * email, and answers with a page rather than JSON. No sign-in, on purpose — a
 * way out that needs a password is one people do not finish, and then report
 * as spam instead.
 *
 * A GET that changes something, which is normally wrong. Here it is what an
 * unsubscribe link is: the thing being changed is only ever switched OFF, and
 * doing it twice is the same as doing it once.
 */
@Controller('offers')
export class OffersUnsubscribeController {
  constructor(private readonly offers: OffersService) {}

  /**
   * What a mail app's own "Unsubscribe" button sends (RFC 8058): a POST to the
   * same address, with nobody looking at the reply.
   */
  @Post('unsubscribe/:token')
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribeOneClick(@Param('token') token: string): Promise<void> {
    await this.offers.unsubscribe(token);
  }

  @Get('unsubscribe/:token')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async unsubscribe(@Param('token') token: string): Promise<string> {
    await this.offers.unsubscribe(token);
    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Unsubscribed</title></head>' +
      '<body style="margin:0;background:#F6F4F0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#15171C">' +
      '<div style="max-width:420px;margin:12vh auto;padding:28px;background:#fff;border-radius:22px;text-align:center">' +
      '<h1 style="font-size:22px;margin:0 0 10px">You are unsubscribed</h1>' +
      '<p style="font-size:15px;line-height:1.5;color:#4B505B;margin:0">' +
      'We will not send you emails about services near you. ' +
      'You can turn them back on any time in the app, under Account.</p>' +
      '</div></body></html>'
    );
  }
}
