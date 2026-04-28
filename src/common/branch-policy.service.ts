import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { CurrentUser } from './auth.types';

@Injectable()
export class BranchPolicyService {
  isAdmin(user: CurrentUser) {
    return user.role === 'ADMIN';
  }

  resolveReadBranchId(user: CurrentUser, requestedBranchId?: string) {
    if (this.isAdmin(user)) {
      return requestedBranchId || undefined;
    }
    if (!user.branchId) {
      throw new ForbiddenException('Tài khoản chưa được gán chi nhánh');
    }
    if (requestedBranchId && requestedBranchId !== user.branchId) {
      throw new ForbiddenException('Không có quyền xem dữ liệu chi nhánh khác');
    }
    return user.branchId;
  }

  resolveWriteBranchId(user: CurrentUser, payloadBranchId?: string | null) {
    if (this.isAdmin(user)) {
      return payloadBranchId || null;
    }
    if (!user.branchId) {
      throw new ForbiddenException('Tài khoản chưa được gán chi nhánh');
    }
    if (payloadBranchId && payloadBranchId !== user.branchId) {
      throw new ForbiddenException('Không có quyền thao tác dữ liệu chi nhánh khác');
    }
    return user.branchId;
  }

  assertResourceBranchAccess(user: CurrentUser, resourceBranchId?: string | null) {
    if (this.isAdmin(user)) return;
    if (!user.branchId) {
      throw new ForbiddenException('Tài khoản chưa được gán chi nhánh');
    }
    if (!resourceBranchId) {
      throw new BadRequestException('Dữ liệu chưa gắn chi nhánh');
    }
    if (resourceBranchId !== user.branchId) {
      throw new ForbiddenException('Không có quyền truy cập dữ liệu chi nhánh khác');
    }
  }
}
