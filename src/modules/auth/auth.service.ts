import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PgService } from '../../database/pg.service';
import * as bcrypt from 'bcryptjs';

type UserRow = {
  id: string;
  username: string;
  password: string;
  fullName: string | null;
  role: string;
  branchId: string | null;
  isActive: boolean;
  branchName: string | null;
};

@Injectable()
export class AuthService {
  constructor(private db: PgService) {}

  async login(username: string, password: string, branchId: string) {
    const users = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.password, u."fullName", u.role, u."branchId", u."isActive", b.name AS "branchName"
       FROM users u
       LEFT JOIN branches b ON b.id = u."branchId"
       WHERE u.username = $1
       LIMIT 1`,
      [username],
    );
    const user = users[0];

    if (!user) {
      throw new UnauthorizedException('Tên đăng nhập không đúng');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Tài khoản đã bị vô hiệu hóa');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Mật khẩu không đúng');
    }

    let selectedBranchId = user.branchId;
    let selectedBranchName = user.branchName;

    if (branchId) {
      const branches = await this.db.query<{ id: string; name: string }>(
        'SELECT id, name FROM branches WHERE id = $1 AND "isActive" = true LIMIT 1',
        [branchId],
      );
      const selectedBranch = branches[0];
      if (!selectedBranch) {
        throw new UnauthorizedException('Chi nhánh không tồn tại hoặc đã ngừng hoạt động');
      }

      if (user.role !== 'ADMIN' && user.branchId !== branchId) {
        throw new UnauthorizedException('Người dùng không thuộc chi nhánh này');
      }

      selectedBranchId = selectedBranch.id;
      selectedBranchName = selectedBranch.name;
    }

    const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');

    return {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        branchId: selectedBranchId,
        branchName: selectedBranchName,
      },
      token,
    };
  }

  async validateToken(token: string) {
    const [userId] = Buffer.from(token, 'base64').toString().split(':');
    const users = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.password, u."fullName", u.role, u."branchId", u."isActive", b.name AS "branchName"
       FROM users u
       LEFT JOIN branches b ON b.id = u."branchId"
       WHERE u.id = $1
       LIMIT 1`,
      [userId],
    );
    const user = users[0];

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Token không hợp lệ');
    }

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      branchId: user.branchId,
      branchName: user.branchName,
    };
  }
}
