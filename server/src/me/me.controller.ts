import { Body, Controller, Delete, Get, Patch, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { KakaoClient } from '../auth/kakao.client';
import { SessionService, SessionUser } from '../auth/session.service';
import { UsersService } from '../auth/users.service';
import { MessagesService } from '../messages/messages.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    private readonly orders: OrdersService,
    private readonly messages: MessagesService,
    private readonly kakao: KakaoClient,
    private readonly prisma: PrismaService,
  ) {}

  /** 비로그인도 200으로 user:null. 화면 첫 로딩에 필요한 계정·내 주문 전체·새 답변 수를 한 번에 준다. */
  @Get()
  async me(@Req() req: Request) {
    const user = await this.sessions.resolve(req);
    if (!user) return { user: null, orders: [], unread: 0 };
    const [orders, unread] = await Promise.all([this.orders.mine(user.id), this.messages.unreadForUser(user.id)]);
    return { user, orders, unread };
  }

  /** 운영자 등록(ADMIN_KAKAO_IDS)에 넣을 본인 카카오 회원번호 확인용. */
  @Get('kakao-id')
  @UseGuards(AuthGuard)
  async kakaoId(@CurrentUser() user: SessionUser) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { kakaoId: true } });
    return { kakaoId: row.kakaoId };
  }

  @Patch()
  @UseGuards(AuthGuard)
  async update(@Body() body: { nickname?: unknown }, @CurrentUser() user: SessionUser) {
    const nickname = await this.users.setNickname(user.id, body?.nickname);
    return { user: { ...user, nickname } };
  }

  @Delete()
  @UseGuards(AuthGuard)
  async withdraw(@CurrentUser() user: SessionUser, @Req() req: Request, @Res() res: Response) {
    const kakaoId = await this.users.withdraw(user.id);
    await this.sessions.destroy(req, res);
    const unlinked = kakaoId && !kakaoId.startsWith('mock-') ? await this.kakao.unlink(kakaoId) : false;
    res.json({ ok: true, kakaoUnlinked: unlinked });
  }
}
