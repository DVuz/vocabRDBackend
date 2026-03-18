import { createParamDecorator, ExecutionContext } from '@nestjs/common';

type AuthenticatedUser = {
  userId: number;
  email: string;
  role: string;
};

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!data) {
      return user;
    }

    return user?.[data];
  },
);
