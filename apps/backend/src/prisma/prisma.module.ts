import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so AuthModule, and every module we add after it
// (Business, Appointments, Payments, Chat...) can inject PrismaService
// without re-importing this module everywhere.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
