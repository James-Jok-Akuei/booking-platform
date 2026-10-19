import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * security.txt (RFC 9116) on the API's own address too (§298): someone who
 * finds a weakness here knows whom to tell. The website serves the same file.
 * `SECURITY_CONTACT_EMAIL` names the inbox; it falls back to the address the
 * Terms and the website already give.
 */
@ApiExcludeController()
@Controller('.well-known')
export class SecurityTxtController {
  constructor(private readonly config: ConfigService) {}

  @Get('security.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  securityTxt(): string {
    const contact = this.config.get<string>('SECURITY_CONTACT_EMAIL') || 'jokditakeerleek@gmail.com';
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expires.setUTCHours(0, 0, 0, 0);
    return [
      `Contact: mailto:${contact}`,
      `Expires: ${expires.toISOString()}`,
      'Preferred-Languages: en, fr, rw',
      '',
    ].join('\n');
  }
}
