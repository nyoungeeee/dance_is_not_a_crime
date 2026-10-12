import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CLOSED_STATUSES, validateNickname } from '../common/group-buy';
import { fail } from '../common/errors';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 카카오 계정을 찾거나 새로 만든다. 탈퇴한 계정은 kakaoId가 지워져 있어 새 계정이 된다. */
  async upsertByKakaoId(kakaoId: string) {
    const now = new Date();
    return this.prisma.user.upsert({
      where: { kakaoId },
      update: { lastLoginAt: now },
      create: { kakaoId, lastLoginAt: now },
    });
  }

  async setNickname(userId: number, raw: unknown): Promise<string> {
    const nickname = validateNickname(raw);
    await this.prisma.user.update({ where: { id: userId }, data: { nickname } });
    return nickname;
  }

  /**
   * 탈퇴: 진행 중인 주문이 있으면 막는다.
   * 카카오 회원번호를 지우고 닉네임을 비식별 값으로 바꾼다. 세션과 문의 대화는 삭제한다.
   * 주문 기록(입금자명·금액)은 입금 대조와 환불 확인을 위해 남긴다.
   * 반환값은 카카오 연결 해제에 쓸 회원번호.
   */
  async withdraw(userId: number): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.order.count({ where: { userId, status: { notIn: [...CLOSED_STATUSES] } } });
      if (active) fail(409, 'ACTIVE_ORDER', '진행 중인 주문이 있어요. 주문 처리 후 탈퇴할 수 있어요.');
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await tx.message.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { kakaoId: null, nickname: `탈퇴회원_${userId}`, withdrawnAt: new Date() },
      });
      return user.kakaoId;
    });
  }
}
