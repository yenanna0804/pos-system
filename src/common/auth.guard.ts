import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../modules/auth/auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers?.authorization as string | undefined;
    const token = auth?.replace('Bearer ', '').trim();

    if (!token) {
      throw new UnauthorizedException('Token required');
    }

    req.currentUser = await this.authService.validateToken(token);
    return true;
  }
}
