import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../mail/mail.module';

// Global, for the same reason PrismaModule is: JwtAuthGuard and RolesGuard are
// used by every feature module we add after this one (Business, Appointments,
// Payments, Chat...). JwtAuthGuard extends Passport's AuthGuard, which injects
// AuthModuleOptions — so any module using the guard needs PassportModule in
// scope. Exporting it from a global AuthModule means feature modules get the
// guards for free instead of re-importing PassportModule everywhere.
@Global()
@Module({
  imports: [
    // Must be .register(), not the bare PassportModule: the bare class is
    // @Module({}) and provides nothing. AuthModuleOptions — which AuthGuard,
    // and therefore JwtAuthGuard, injects — only exists via register().
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // secrets/expiry are set per-sign-call in AuthService
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, PassportModule, JwtModule],
})
export class AuthModule {}
