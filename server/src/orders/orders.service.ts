import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import type { Order } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { fail } from '../common/errors';
import {
  EVENTS,
  GROUP_BUY,
  ORDER_STATUSES,
  OrderStatus,
  REORDERABLE_STATUSES,
  ordersOpen,
  validateOrderInput,
  validatePickupDate,
} from '../common/group-buy';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export function orderDto(o: Order) {
  return {
    id: o.id,
    nickname: o.nickname,
    quantity: o.quantity,
    event: o.event,
    pickupDate: o.pickupDate,
    payerName: o.payerName,
    unitPrice: o.unitPrice,
    totalAmount: o.totalAmount,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function newOrderId(): string {
  return `DNC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 진행 중인 주문이 있으면 그것, 없으면 가장 최근 주문. */
  async current(userId: number, tx: Tx | PrismaService = this.prisma): Promise<Order | null> {
    const active = await tx.order.findFirst({
      where: { userId, status: { notIn: [...REORDERABLE_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
    return active ?? tx.order.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  private async log(tx: Tx, orderId: string, actor: 'user' | 'admin', actorUserId: number, fromStatus: string | null, toStatus: string, note?: string) {
    await tx.orderLog.create({ data: { orderId, actor, actorUserId, fromStatus, toStatus, note } });
  }

  /** 주문서 제출: 진행 중인 주문이 없으면 새로 만들고, 마감 전 입금 대기 주문이면 수정한다. */
  async submit(userId: number, nickname: string, body: unknown, now = new Date()) {
    if (!ordersOpen(now)) fail(409, 'ORDERS_CLOSED', '주문 접수가 마감되었어요.');
    const input = validateOrderInput(body);
    const totalAmount = input.quantity * GROUP_BUY.unitPrice;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { userId, status: { notIn: [...REORDERABLE_STATUSES] } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && existing.status !== 'payment_pending') {
        fail(409, 'ORDER_LOCKED', '입금 확인 또는 취소 확인 중에는 주문을 수정할 수 없어요.');
      }
      if (existing) {
        const order = await tx.order.update({
          where: { id: existing.id },
          data: { ...input, nickname, unitPrice: GROUP_BUY.unitPrice, totalAmount },
        });
        await this.log(tx, order.id, 'user', userId, 'payment_pending', 'payment_pending', '주문서 수정');
        return { order: orderDto(order), created: false };
      }
      const order = await tx.order.create({
        data: { id: newOrderId(), userId, nickname, ...input, unitPrice: GROUP_BUY.unitPrice, totalAmount, status: 'payment_pending' },
      });
      await this.log(tx, order.id, 'user', userId, null, 'payment_pending', '주문서 제출');
      return { order: orderDto(order), created: true };
    });
  }

  private async requireActive(tx: Tx, userId: number): Promise<Order> {
    const order = await this.current(userId, tx);
    if (!order) fail(404, 'NO_ORDER', '주문 내역이 없어요.');
    return order;
  }

  async setPickupDate(userId: number, date: unknown, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireActive(tx, userId);
      if (!ordersOpen(now) || !['payment_pending', 'verification_requested'].includes(order.status)) {
        fail(409, 'ORDER_LOCKED', '현재 상태에서는 수령일을 바꿀 수 없어요.');
      }
      if (!EVENTS[order.event]?.available) fail(400, 'EVENT_UNAVAILABLE', '세종보헤미안뮤직페스티벌 수령은 추후 오픈 예정이에요.');
      const pickupDate = validatePickupDate(order.event, date);
      const updated = await tx.order.update({ where: { id: order.id }, data: { pickupDate } });
      await this.log(tx, order.id, 'user', userId, order.status, order.status, `수령일 ${pickupDate}`);
      return orderDto(updated);
    });
  }

  /** 입금 확인 요청. 입금 완료가 아니다. 운영자가 입금 내역을 대조한 뒤 paid로 바꾼다. */
  async requestPaymentCheck(userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireActive(tx, userId);
      if (order.status !== 'payment_pending') fail(409, 'ORDER_LOCKED', '이미 요청되었거나 취소된 주문이에요.');
      const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'verification_requested' } });
      await this.log(tx, order.id, 'user', userId, order.status, updated.status);
      return orderDto(updated);
    });
  }

  /** 마감 전 입금 대기 주문은 바로 취소, 그 외에는 운영자 확인이 필요한 취소 요청으로 남긴다. */
  async cancel(userId: number, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireActive(tx, userId);
      if (['cancelled', 'cancel_requested', 'refunded', 'picked_up'].includes(order.status)) {
        fail(409, 'ORDER_LOCKED', '이미 취소되었거나 처리 중인 주문이에요.');
      }
      const status = order.status === 'payment_pending' && ordersOpen(now) ? 'cancelled' : 'cancel_requested';
      const updated = await tx.order.update({ where: { id: order.id }, data: { status } });
      await this.log(tx, order.id, 'user', userId, order.status, status);
      return orderDto(updated);
    });
  }

  // ---- 운영자 ----

  async listAll() {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: 'asc' },
      include: { logs: { orderBy: { createdAt: 'asc' } } },
    });
    return orders.map((o) => ({
      ...orderDto(o),
      logs: o.logs.map((l) => ({ actor: l.actor, fromStatus: l.fromStatus, toStatus: l.toStatus, note: l.note, createdAt: l.createdAt.toISOString() })),
    }));
  }

  /** 운영자는 입금 대조 결과에 따라 어떤 상태로든 바꿀 수 있다. 모든 변경은 기록으로 남는다. */
  async adminSetStatus(adminUserId: number, orderId: string, status: unknown, note: unknown) {
    if (typeof status !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(status)) fail(400, 'INVALID_STATUS', '알 수 없는 상태예요.');
    const memo = typeof note === 'string' ? note.trim().slice(0, 200) : '';
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) fail(404, 'NO_ORDER', '주문을 찾을 수 없어요.');
      if (REORDERABLE_STATUSES.includes(order.status) && !REORDERABLE_STATUSES.includes(status)) {
        const other = await tx.order.count({ where: { userId: order.userId, id: { not: order.id }, status: { notIn: [...REORDERABLE_STATUSES] } } });
        if (other) fail(409, 'ACTIVE_ORDER', '이 사용자에게 진행 중인 다른 주문이 있어 되돌릴 수 없어요.');
      }
      const updated = await tx.order.update({ where: { id: orderId }, data: { status: status as OrderStatus } });
      await this.log(tx, orderId, 'admin', adminUserId, order.status, status, memo || undefined);
      return orderDto(updated);
    });
  }
}
