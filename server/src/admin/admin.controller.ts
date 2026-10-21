import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AdminGuard, CurrentUser } from '../auth/auth.guard';
import { SessionUser } from '../auth/session.service';
import { fail } from '../common/errors';
import { MessagesService } from '../messages/messages.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma.service';
import { LedgerService } from './ledger.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly orders: OrdersService,
    private readonly messages: MessagesService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  @Get('orders')
  async listOrders() {
    return { orders: await this.orders.listAll() };
  }

  @Post('orders/:id/status')
  async setStatus(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: { status?: unknown; note?: unknown }) {
    return { order: await this.orders.adminSetStatus(admin.id, id, body?.status, body?.note) };
  }

  /** 수령 행사·날짜 변경(1차 미수령분 세종 이월 등). */
  @Post('orders/:id/pickup')
  async setPickup(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body() body: { event?: unknown; pickupDate?: unknown; note?: unknown }) {
    return { order: await this.orders.adminSetPickup(admin.id, id, body?.event, body?.pickupDate, body?.note) };
  }

  /** 현장 수령 전달 완료. 입금 확인 완료(paid) 주문만, 전부 아니면 409로 아무것도 안 바꾼다. */
  @Post('pickup')
  async pickup(@CurrentUser() admin: SessionUser, @Body() body: { orderIds?: unknown }) {
    return { orders: await this.orders.adminPickup(admin.id, body?.orderIds) };
  }

  /** 방금 누른 전달 완료를 되돌린다(picked_up → paid). */
  @Post('pickup/undo')
  async undoPickup(@CurrentUser() admin: SessionUser, @Body() body: { orderIds?: unknown }) {
    return { orders: await this.orders.adminPickup(admin.id, body?.orderIds, true) };
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

  @Get('ledger')
  async ledgerOverview() {
    return this.ledger.overview();
  }

  @Post('ledger')
  async addLedger(@CurrentUser() admin: SessionUser, @Body() body: Record<string, unknown>) {
    return { entry: await this.ledger.add(admin.id, body) };
  }

  @Delete('ledger/:id')
  async removeLedger(@CurrentUser() admin: SessionUser, @Param('id', ParseIntPipe) id: number) {
    await this.ledger.remove(admin.id, id);
    return { ok: true };
  }
}
