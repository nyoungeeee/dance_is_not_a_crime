import { Injectable } from '@nestjs/common';
import type { Message } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { fail } from '../common/errors';
import { validateMessage } from '../common/group-buy';

/** 도배 방지: 10분에 20개까지. */
const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 20;

function messageDto(m: Message) {
  return { id: m.id, sender: m.sender, text: m.text, createdAt: m.createdAt.toISOString(), read: !!m.readAt };
}

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** viewer가 대화를 열면 상대가 보낸 안 읽은 메시지를 읽음 처리한다. */
  async thread(userId: number, viewer: 'user' | 'operator') {
    const other = viewer === 'user' ? 'operator' : 'user';
    await this.prisma.message.updateMany({ where: { userId, sender: other, readAt: null }, data: { readAt: new Date() } });
    const messages = await this.prisma.message.findMany({ where: { userId }, orderBy: { id: 'asc' } });
    return messages.map(messageDto);
  }

  unreadForUser(userId: number) {
    return this.prisma.message.count({ where: { userId, sender: 'operator', readAt: null } });
  }

  async send(userId: number, sender: 'user' | 'operator', raw: unknown, operatorId?: number) {
    const text = validateMessage(raw);
    const recent = await this.prisma.message.count({
      where: { userId, sender, createdAt: { gt: new Date(Date.now() - BURST_WINDOW_MS) } },
    });
    if (recent >= BURST_LIMIT) fail(429, 'TOO_MANY_MESSAGES', '잠시 후 다시 보내주세요.');
    const message = await this.prisma.message.create({ data: { userId, sender, text, operatorId } });
    return messageDto(message);
  }

  /**
   * 운영자가 고른 주문의 주인들에게 같은 문구를 각자의 문의 대화로 보낸다. 한 사람에게는 한 번만.
   * 문구의 {닉네임}은 그 사람 닉네임, {주문}은 고른 주문 중 그 사람 것("DNC-… 2개, DNC-… 1개")으로 바뀐다.
   * 바뀐 문구가 500자를 넘는 사람이 있으면 아무에게도 보내지 않는다. 탈퇴한 사람은 건너뛴다.
   */
  async broadcast(operatorId: number, rawOrderIds: unknown, rawText: unknown) {
    if (!Array.isArray(rawOrderIds) || !rawOrderIds.length || rawOrderIds.length > 500 || !rawOrderIds.every((id) => typeof id === 'string')) {
      fail(400, 'INVALID_ORDERS', '메시지를 보낼 주문을 골라주세요.');
    }
    const template = validateMessage(rawText);
    const ids = [...new Set(rawOrderIds as string[])];
    const orders = await this.prisma.order.findMany({ where: { id: { in: ids } }, include: { user: { select: { id: true, nickname: true, withdrawnAt: true } } }, orderBy: { createdAt: 'asc' } });
    if (orders.length !== ids.length) fail(404, 'NO_ORDER', '없는 주문이 섞여 있어요. 새로고침해주세요.');
    const byUser = new Map<number, typeof orders>();
    for (const o of orders) byUser.set(o.userId, [...(byUser.get(o.userId) ?? []), o]);
    const drafts: { userId: number; text: string }[] = [];
    let skipped = 0;
    for (const [userId, mine] of byUser) {
      const user = mine[0].user;
      if (user.withdrawnAt) { skipped++; continue; }
      const text = template
        .replaceAll('{닉네임}', user.nickname ?? mine[0].nickname)
        .replaceAll('{주문}', mine.map((o) => `${o.id} ${o.quantity}개`).join(', '));
      if ([...text].length > 500) fail(400, 'MESSAGE_TOO_LONG', `${user.nickname ?? userId} 님에게 갈 메시지가 500자를 넘어요. 문구를 줄여주세요.`);
      drafts.push({ userId, text });
    }
    if (!drafts.length) fail(400, 'NO_RECIPIENTS', '보낼 수 있는 사람이 없어요(모두 탈퇴).');
    await this.prisma.$transaction(drafts.map((d) => this.prisma.message.create({ data: { userId: d.userId, sender: 'operator', text: d.text, operatorId } })));
    return { sent: drafts.length, skipped };
  }

  /** 운영자 문의 목록: 대화가 있는 사용자별 마지막 메시지와 안 읽은 수. */
  async threads() {
    const users = await this.prisma.user.findMany({
      where: { messages: { some: {} } },
      select: {
        id: true,
        nickname: true,
        withdrawnAt: true,
        messages: { orderBy: { id: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { sender: 'user', readAt: null } } } },
      },
    });
    return users
      .map((u) => ({
        userId: u.id,
        nickname: u.nickname,
        lastMessage: u.messages[0] ? messageDto(u.messages[0]) : null,
        unread: u._count.messages,
      }))
      .sort((a, b) => (b.lastMessage?.id ?? 0) - (a.lastMessage?.id ?? 0));
  }
}
