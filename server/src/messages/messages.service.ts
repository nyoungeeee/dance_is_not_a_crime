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
