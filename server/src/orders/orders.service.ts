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
  ROUNDS,
  currentRound,
  ordersOpen,
  roundOpen,
  validateOrderInput,
  validatePickupDate,
} from '../common/group-buy';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export function orderDto(o: Order) {
  return {
    id: o.id,
    round: o.round,
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
    if (currentRound(now).accepting === false && roundOpen(currentRound(now).id, now)) fail(409, 'ORDERS_NOT_OPEN', '주문은 아직 열리지 않았어요. 오픈하면 오픈카톡방에서 알려드려요.');
    if (!ordersOpen(now)) fail(409, 'ORDERS_CLOSED', '주문 접수가 마감되었어요.');
    const round = currentRound(now);
    const input = validateOrderInput(body, round);
    const agree = body as { pickupTermsAgreed?: unknown; petitionPledged?: unknown } | null;
    if (round.pickupTerms && agree?.pickupTermsAgreed !== true) fail(400, 'PICKUP_TERMS_REQUIRED', '수령 안내를 읽고 동의해주세요.');
    if (round.petitionPledge && agree?.petitionPledged !== true) fail(400, 'PETITION_PLEDGE_REQUIRED', '다음 청원 참여에 동의해주세요.');
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
          round: round.id,
          nickname,
          ...input,
          unitPrice: GROUP_BUY.unitPrice,
          totalAmount: input.quantity * GROUP_BUY.unitPrice,
          status: 'payment_pending',
        },
      });
      // 동의 항목은 주문 기록에 시각과 함께 남긴다(수령 안내: 미수령 시 택배·환불 불가의 근거, 청원: 다음 청원 때 안내할 사람).
      const agreed = [round.pickupTerms && '수령 안내 동의', round.petitionPledge && '다음 청원 참여 동의'].filter(Boolean);
      await this.log(tx, order.id, 'user', userId, null, 'payment_pending', ['주문서 제출', ...agreed].join(' · '));
      return { order: orderDto(order), created: true };
    });
  }

  /** 주문서 수정: 그 주문 차수의 마감 전, 입금 대기 상태에서만. */
  async update(userId: number, nickname: string, orderId: string, body: unknown, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.own(tx, userId, orderId);
      if (!roundOpen(order.round, now)) fail(409, 'ORDERS_CLOSED', '주문 접수가 마감되었어요.');
      const input = validateOrderInput(body, ROUNDS.find((r) => r.id === order.round)!);
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
      if (!roundOpen(order.round, now) || !['payment_pending', 'verification_requested'].includes(order.status)) {
        fail(409, 'ORDER_LOCKED', '현재 상태에서는 수령일을 바꿀 수 없어요.');
      }
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
      const status = order.status === 'payment_pending' && roundOpen(order.round, now) ? 'cancelled' : 'cancel_requested';
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

  /**
   * 수령 행사·날짜 변경(예: 1차 경기 미수령분을 세종으로 이월). 차수·수량·금액·상태는 그대로 두고 기록을 남긴다.
   * 이미 끝난 주문(취소·환불·수령 완료)은 바꾸지 않는다.
   */
  async adminSetPickup(adminUserId: number, orderId: string, event: unknown, pickupDate: unknown, note: unknown) {
    if (typeof event !== 'string' || !Object.hasOwn(EVENTS, event)) fail(400, 'INVALID_EVENT', '수령할 행사를 골라주세요.');
    const date = validatePickupDate(event, pickupDate);
    const memo = typeof note === 'string' ? note.trim().slice(0, 200) : '';
    const label = (e: string, d: string | null) => `${EVENTS[e]?.name ?? e} ${d ?? '수령일 없음'}`;
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) fail(404, 'NO_ORDER', '주문을 찾을 수 없어요.');
      if (CLOSED_STATUSES.includes(order.status)) fail(409, 'ORDER_LOCKED', '취소·환불·수령 완료된 주문은 수령일을 바꿀 수 없어요.');
      if (order.event === event && order.pickupDate === date) fail(409, 'NO_CHANGE', '이미 그 수령일이에요.');
      const updated = await tx.order.update({ where: { id: orderId }, data: { event, pickupDate: date } });
      const change = `수령 변경 ${label(order.event, order.pickupDate)} → ${label(event, date)}`;
      await this.log(tx, orderId, 'admin', adminUserId, order.status, order.status, memo ? `${change} · ${memo}` : change);
      return orderDto(updated);
    });
  }

  /**
   * 현장 수령: 한 사람의 주문 여러 건을 한 번에 from → to로 바꾼다. 전부 바뀌거나 하나도 안 바뀐다.
   * 상태 조건을 UPDATE의 WHERE에 넣어서, 폰 두 대가 같은 주문을 동시에 눌러도 한 번만 처리된다.
   * 전달: paid → picked_up (입금 확인 전·이미 수령·취소 주문은 거절), 되돌리기: picked_up → paid.
   */
  async adminPickup(adminUserId: number, orderIds: unknown, undo = false) {
    if (!Array.isArray(orderIds) || !orderIds.length || orderIds.length > 20 || !orderIds.every((id) => typeof id === 'string')) {
      fail(400, 'INVALID_ORDERS', '주문을 골라주세요.');
    }
    const ids = [...new Set(orderIds as string[])];
    const [from, to, note] = undo ? (['picked_up', 'paid', '현장 수령 되돌리기'] as const) : (['paid', 'picked_up', '현장 수령'] as const);
    return this.prisma.$transaction(async (tx) => {
      for (const id of ids) {
        const { count } = await tx.order.updateMany({ where: { id, status: from }, data: { status: to } });
        if (count === 1) {
          await this.log(tx, id, 'admin', adminUserId, from, to, note);
          continue;
        }
        // 바꾸지 못한 이유를 알려주고 트랜잭션 전체를 되돌린다.
        const order = await tx.order.findUnique({ where: { id } });
        if (!order) fail(404, 'NO_ORDER', '주문을 찾을 수 없어요.');
        if (undo) fail(409, 'NOT_PICKED_UP', `${id}는 수령 완료 상태가 아니에요. 새로고침해주세요.`);
        if (order.status === 'picked_up') fail(409, 'ALREADY_PICKED_UP', `${id}는 이미 수령 완료된 주문이에요. 새로고침해주세요.`);
        fail(409, 'NOT_PAID', `${id}는 입금 확인 완료 주문이 아니에요. 전달하지 마세요.`);
      }
      const orders = await tx.order.findMany({ where: { id: { in: ids } } });
      return orders.map(orderDto);
    });
  }
}
