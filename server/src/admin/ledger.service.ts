import { Injectable } from '@nestjs/common';
import type { LedgerEntry } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { fail } from '../common/errors';
import { ROUNDS, currentRound } from '../common/group-buy';

/** 장부 항목 종류. in이면 공구 통장으로 들어온 돈, out이면 나간 돈. */
export const LEDGER_KINDS = {
  vendor_payment: 'out',
  advance: 'in',
  reimburse: 'out',
  other_in: 'in',
  other_out: 'out',
} as const;
export type LedgerKind = keyof typeof LEDGER_KINDS;

/** 입금 확인된 것으로 셀 주문 상태. 환불된 주문은 들어왔다 나간 돈이라 빼고 센다. */
// 수령 포기(forfeited)도 입금은 들어온 주문이라 주문 입금에 넣는다.
// 1차 이월(carried_over)도 1차에 입금받은 주문이다.
const PAID_STATUSES = ['paid', 'picked_up', 'forfeited', 'carried_over'];

function entryDto(e: LedgerEntry) {
  return {
    id: e.id,
    kind: e.kind,
    round: e.round,
    amount: e.amount,
    quantity: e.quantity,
    memo: e.memo,
    occurredAt: e.occurredAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
  };
}

function validate(body: Record<string, unknown> | undefined) {
  const kind = body?.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(LEDGER_KINDS, kind)) fail(400, 'BAD_KIND', '종류를 골라주세요.');
  const amount = body?.amount;
  if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > 100_000_000) fail(400, 'BAD_AMOUNT', '금액을 1원 이상의 정수로 입력해주세요.');
  const rawQty = body?.quantity;
  let quantity: number | null = null;
  if (rawQty !== null && rawQty !== undefined && rawQty !== '') {
    if (!Number.isInteger(rawQty) || (rawQty as number) < 0 || (rawQty as number) > 100_000) fail(400, 'BAD_QUANTITY', '수량은 0 이상의 정수로 입력해주세요.');
    quantity = rawQty as number;
  }
  const memo = String(body?.memo ?? '').trim();
  if ([...memo].length > 200 || /[\u0000-\u001f]/u.test(memo)) fail(400, 'BAD_MEMO', '메모는 200자 이내로 입력해주세요.');
  // 차수를 안 보내면 지금 받는(또는 마지막으로 받은) 차수
  const round = body?.round ?? currentRound().id;
  if (!ROUNDS.some((r) => r.id === round)) fail(400, 'BAD_ROUND', '차수를 확인해주세요.');
  const occurredAt = new Date(String(body?.occurredAt ?? ''));
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getFullYear() < 2026 || occurredAt.getFullYear() > 2030) fail(400, 'BAD_DATE', '날짜를 확인해주세요.');
  return { kind: kind as LedgerKind, round: round as number, amount: amount as number, quantity, memo, occurredAt };
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * summary: 전체(통장 하나 기준). byRound: 차수별(1차 인뮤페 / 2차 세종).
   * 주문 입금은 주문의 차수로 나눈다. 1차 주문을 세종 수령으로 옮긴 이월분은 1차에 입금·발주했으므로 1차에 남는다.
   */
  async overview() {
    const [entries, paid] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { deletedAt: null }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.order.groupBy({ by: ['round'], where: { status: { in: PAID_STATUSES } }, _sum: { totalAmount: true, quantity: true }, _count: true }),
    ]);
    const summarize = (round?: number) => {
      const mine = entries.filter((e) => round === undefined || e.round === round);
      const orders = paid.filter((p) => round === undefined || p.round === round);
      const sum = (kind: LedgerKind, field: 'amount' | 'quantity' = 'amount') =>
        mine.filter((e) => e.kind === kind).reduce((a, e) => a + (e[field] ?? 0), 0);
      const orderIncome = {
        count: orders.reduce((a, p) => a + p._count, 0),
        quantity: orders.reduce((a, p) => a + (p._sum.quantity ?? 0), 0),
        amount: orders.reduce((a, p) => a + (p._sum.totalAmount ?? 0), 0),
      };
      const vendor = { quantity: sum('vendor_payment', 'quantity'), amount: sum('vendor_payment') };
      const advance = sum('advance');
      const reimbursed = sum('reimburse');
      const otherIn = sum('other_in');
      const otherOut = sum('other_out');
      return {
        orderIncome,
        vendor,
        advance,
        reimbursed,
        outstandingAdvance: advance - reimbursed,
        otherIn,
        otherOut,
        // 공구 통장에 남아 있어야 할 돈(계산값). 실제 통장 잔액과 맞춰 보는 용도.
        balance: orderIncome.amount + advance + otherIn - vendor.amount - reimbursed - otherOut,
        // 발주했지만 아직 입금 확인된 주문과 연결되지 않은 수량(예비·미입금분)
        unmatchedQuantity: vendor.quantity - orderIncome.quantity,
      };
    };
    return {
      summary: summarize(),
      byRound: Object.fromEntries(ROUNDS.map((r) => [r.id, summarize(r.id)])),
      entries: entries.map(entryDto),
    };
  }

  async add(adminId: number, body: Record<string, unknown> | undefined) {
    const data = validate(body);
    return entryDto(await this.prisma.ledgerEntry.create({ data: { ...data, createdBy: adminId } }));
  }

  /** 지워도 행은 남겨 두고 목록·합계에서만 뺀다. */
  async remove(adminId: number, id: number) {
    const r = await this.prisma.ledgerEntry.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: adminId } });
    if (!r.count) fail(404, 'NO_ENTRY', '내역을 찾을 수 없어요.');
  }
}
