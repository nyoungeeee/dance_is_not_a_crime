import { Body, Controller, Get, HttpCode, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, requireNickname } from '../auth/auth.guard';
import { SessionUser } from '../auth/session.service';
import { OrdersService, orderDto } from './orders.service';

@Controller('orders/mine')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async mine(@CurrentUser() user: SessionUser) {
    const order = await this.orders.current(user.id);
    return { order: order ? orderDto(order) : null };
  }

  @Put()
  submit(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.orders.submit(user.id, requireNickname(user), body);
  }

  @Patch('pickup-date')
  async pickupDate(@CurrentUser() user: SessionUser, @Body() body: { pickupDate?: unknown }) {
    return { order: await this.orders.setPickupDate(user.id, body?.pickupDate) };
  }

  @Post('payment-request')
  @HttpCode(200)
  async paymentRequest(@CurrentUser() user: SessionUser) {
    return { order: await this.orders.requestPaymentCheck(user.id) };
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: SessionUser) {
    return { order: await this.orders.cancel(user.id) };
  }
}
