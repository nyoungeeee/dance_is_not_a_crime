import { Controller, Get, Module } from '@nestjs/common';
import { loadConfig, CONFIG } from './config';
import { PrismaService } from './prisma.service';
import { SessionService } from './auth/session.service';
import { UsersService } from './auth/users.service';
import { KakaoClient } from './auth/kakao.client';
import { AuthGuard, AdminGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { MeController } from './me/me.controller';
import { OrdersService } from './orders/orders.service';
import { OrdersController } from './orders/orders.controller';
import { MessagesService } from './messages/messages.service';
import { MessagesController } from './messages/messages.controller';
import { AdminController } from './admin/admin.controller';
import { LedgerService } from './admin/ledger.service';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}

@Module({
  controllers: [HealthController, AuthController, MeController, OrdersController, MessagesController, AdminController],
  providers: [
    { provide: CONFIG, useFactory: loadConfig },
    PrismaService,
    SessionService,
    UsersService,
    KakaoClient,
    AuthGuard,
    AdminGuard,
    OrdersService,
    MessagesService,
    LedgerService,
  ],
})
export class AppModule {}
