import { Module } from '@nestjs/common';
import { SecurityTxtController } from './security-txt.controller';

/** Files at /.well-known/ (§298). */
@Module({ controllers: [SecurityTxtController] })
export class WellKnownModule {}
