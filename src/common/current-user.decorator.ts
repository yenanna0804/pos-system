import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from './auth.types';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): CurrentUserType => {
  const req = ctx.switchToHttp().getRequest();
  return req.currentUser as CurrentUserType;
});
