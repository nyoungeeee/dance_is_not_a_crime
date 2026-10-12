import { HttpException } from '@nestjs/common';

/** API 오류는 { code, message, ...extra } 형태로 통일한다. 프론트는 message를 그대로 보여준다. */
export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new HttpException({ code, message, ...extra }, status);
}
