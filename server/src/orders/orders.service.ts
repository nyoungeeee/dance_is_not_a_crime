import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import type { Order } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { fail } from '../common/errors';
import {
  CLOSED_STATUSES,
  EVENTS,
  GROUP_BUY,
  MAX_OPEN_ORDERS,
  ORDER_STATUSES,
  OrderStatus,
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

/** 화면이 주문서마다 만드는 요청 키(UUID 등). 형식이 다르면 무시한다. */
function requestKeyOf(body: unknown): string | null {
  const key = (body as { requestKey?: unknown } | null)?.requestKey;
  return typeof key === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(key) ? key : null;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 내 주문 전체, 최신순. */
  async mine(userId: number) {
    const orders = await this.prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return orders.map(orderDto);
  }

  private async log(tx: Tx, orderId: string, actor: 'user' | 'admin', actorUserId: number, fromStatus: string | null, toStatus: string, note?: string) {
    await tx.orderLog.create({ data: { orderId, actor, actorUserId, fromStatus, toStatus, note } });
  }

  /** 본인 주문만. 다른 사람 주문번호면 없는 주문과 똑같이 응답한다. */
  private async own(tx: Tx, userId: number, orderId: string): Promise<Order> {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) fail(404, 'NO_ORDER', '주문을 찾을 수 없어요.');
    return order;
  }

  /** 새 주문서 제출. 같은 requestKey로 다시 오면 이미 만든 주문을 돌려준다(중복 제출 방지). */
  async create(userId: number, nickname: string, body: unknown, now = new Date()) {
    if (!ordersOpen(now)) fail(409, 'ORDERS_CLOSED', '주문 접수가 마감되었어요.');
    const input = validateOrderInput(body);
    const requestKey = requestKeyOf(body);
    return this.prisma.$transaction(async (tx) => {
      if (requestKey) {
        const same = await tx.order.findUnique({ where: { requestKey } });
        if (same && same.userId === userId) return { order: orderDto(same), created: false };
        if (same) fail(409, 'DUPLICATE_REQUEST', '다시 시도해주세요.');
      }
      const open = await tx.order.count({ where: { userId, status: { notIn: [...CLOSED_STATUSES] } } });
      if (open >= MAX_OPEN_ORDERS) fail(409, 'TOO_MANY_ORDERS', `진행 중인 주문은 ${MAX_OPEN_ORDERS}건까지 가능해요. 문의 메시지로 알려주세요.`);
      const order = await tx.order.create({
        data: {
          id: newOrderId(),
          userId,
          requestKey,
          nickname,
          ...input,
          unitPrice: GROUP_BUY.unitPrice,
          totalAmount: input.quantity * GROUP_BUY.unitPrice,
          status: 'payment_pending',
        },
      });
      await this.log(tx, order.id, 'user', userId, null, 'payment_pending', '주문서 제출');
      return { order: orderDto(order), created: true };
    });
  }

  /** 주문서 수정: 마감 전, 입금 대기 상태에서만. */
  async update(userId: number, nickname: string, orderId: string, body: unknown, now = new Date()) {
    if (!ordersOpen(now)) fail(409, 'ORDERS_CLOSED', '주문 접수가 마감되었어요.');
    const input = validateOrderInput(body);
    return this.prisma.$transaction(async (tx) => {
      const order = await this.own(tx, userId, orderId);
      if (order.status !== 'payment_pending') fail(409, 'ORDER_LOCKED', '입금 확인 요청 이후에는 주문서를 수정할 수 없어요.');
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { ...input, nickname, unitPrice: GROUP_BUY.unitPrice, totalAmount: input.quantity * GROUP_BUY.unitPrice },
      });
      await this.log(tx, orderId, 'user', userId, order.status, order.status, '주문서 수정');
      return orderDto(updated);
    });
  }

  async setPickupDate(userId: number, orderId: string, date: unknown, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.own(tx, userId, orderId);
      if (!ordersOpen(now) || !['payment_pending', 'verification_requested'].includes(order.status)) {
        fail(409, 'ORDER_LOCKED', '현재 상태에서는 수령일을 바꿀 수 없어요.');
      }
      if (!EVENTS[order.event]?.available) fail(400, 'EVENT_UNAVAILABLE', '세종보헤미안뮤직페스티벌 수령은 추후 오픈 예정이에요.');
      const pickupDate = validatePickupDate(order.event, date);
      const updated = await tx.order.update({ where: { id: orderId }, data: { pickupDate } });
      await this.log(tx, orderId, 'user', userId, order.status, order.status, `수령일 ${pickupDate}`);
      return orderDto(updated);
    });
  }

  /** 입금 확인 요청. 입금 완료가 아니다. 운영자가 입금 내역을 대조한 뒤 paid로 바꾼다. */
  async requestPaymentCheck(userId: number, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.own(tx, userId, orderId);
      if (order.status !== 'payment_pending') fail(409, 'ORDER_LOCKED', '이미 요청되었거나 취소된 주문이에요.');
      const updated = await tx.order.update({ where: { id: orderId }, data: { status: 'verification_requested' } });
      await this.log(tx, orderId, 'user', userId, order.status, updated.status);
      return orderDto(updated);
    });
  }

  /** 마감 전 입금 대기 주문은 바로 취소, 그 외에는 운영자 확인이 필요한 취소 요청으로 남긴다. */
  async cancel(userId: number, orderId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.own(tx, userId, orderId);
      if (['cancelled', 'cancel_requested', 'refunded', 'picked_up'].includes(order.status)) {
        fail(409, 'ORDER_LOCKED', '이미 취소되었거나 처리 중인 주문이에요.');
      }
      const status = order.status === 'payment_pending' && ordersOpen(now) ? 'cancelled' : 'cancel_requested';
      const updated = await tx.order.update({ where: { id: orderId }, data: { status } });
      await this.log(tx, orderId, 'user', userId, order.status, status);
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
      userId: o.userId,
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
      const updated = await tx.order.update({ where: { id: orderId }, data: { status: status as OrderStatus } });
      await this.log(tx, orderId, 'admin', adminUserId, order.status, status, memo || undefined);
      return orderDto(updated);
    });
  }
}
