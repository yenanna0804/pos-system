import { BadRequestException, Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

class LoginDto {
  username: string;
  password: string;
  branchId: string;
}

class LoginContextDto {
  username: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password, dto.branchId);
  }

  @Post('login-context')
  async loginContext(@Body() dto: LoginContextDto) {
    return this.authService.getLoginContext(dto.username);
  }

  @Get('me')
  async me(@Headers('authorization') auth: string) {
    const token = auth?.replace('Bearer ', '');
    if (!token) {
      throw new BadRequestException('Token required');
    }
    return this.authService.validateToken(token);
  }
}
