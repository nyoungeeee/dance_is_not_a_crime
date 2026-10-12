import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, requireNickname } from '../auth/auth.guard';
import { SessionUser } from '../auth/session.service';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async mine(@CurrentUser() user: SessionUser) {
    return { orders: await this.orders.mine(user.id) };
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.orders.create(user.id, requireNickname(user), body);
  }

  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    return { order: await this.orders.update(user.id, requireNickname(user), id, body) };
  }

  @Patch(':id/pickup-date')
  async pickupDate(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: { pickupDate?: unknown }) {
    return { order: await this.orders.setPickupDate(user.id, id, body?.pickupDate) };
  }

  @Post(':id/payment-request')
  @HttpCode(200)
  async paymentRequest(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return { order: await this.orders.requestPaymentCheck(user.id, id) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return { order: await this.orders.cancel(user.id, id) };
  }
}
