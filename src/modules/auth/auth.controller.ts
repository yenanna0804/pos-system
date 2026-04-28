import { BadRequestException, Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

class LoginDto {
  username: string;
  password: string;
  branchId: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password, dto.branchId);
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
