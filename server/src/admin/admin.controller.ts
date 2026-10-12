import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AdminGuard, CurrentUser } from '../auth/auth.guard';
import { SessionUser } from '../auth/session.service';
import { fail } from '../common/errors';
import { MessagesService } from '../messages/messages.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly orders: OrdersService,
    private readonly messages: MessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('orders')
  async listOrders() {
    return { orders: await this.orders.listAll() };
  }

  @Post('orders/:id/status')
  async setStatus(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: { status?: unknown; note?: unknown }) {
    return { order: await this.orders.adminSetStatus(admin.id, id, body?.status, body?.note) };
  }

  @Get('threads')
  async threads() {
    return { threads: await this.messages.threads() };
  }

  @Get('threads/:userId')
  async thread(@Param('userId', ParseIntPipe) userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true } });
    if (!user) fail(404, 'NO_USER', '사용자를 찾을 수 없어요.');
    return { user, messages: await this.messages.thread(userId, 'operator') };
  }

  @Post('threads/:userId')
  async reply(@CurrentUser() admin: SessionUser, @Param('userId', ParseIntPipe) userId: number, @Body() body: { text?: unknown }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { withdrawnAt: true } });
    if (!user || user.withdrawnAt) fail(404, 'NO_USER', '사용자를 찾을 수 없어요.');
    return { message: await this.messages.send(userId, 'operator', body?.text, admin.id) };
  }
}
