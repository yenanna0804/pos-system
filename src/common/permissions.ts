import { SetMetadata } from '@nestjs/common';

export const Permission = {
  PRODUCTS_VIEW: 'products:view',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  CATEGORIES_MANAGE: 'categories:manage',

  ORDERS_VIEW: 'orders:view',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE: 'orders:update',
  ORDERS_DELETE: 'orders:delete',

  TABLES_ACCESS: 'tables:access',
  REPORTS_ACCESS: 'reports:access',
  PRINTERS_ACCESS: 'printers:access',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = new Set<PermissionKey>(Object.values(Permission));

export const ROLE_PERMISSIONS: Record<string, Set<PermissionKey>> = {
  ADMIN: ALL_PERMISSIONS,
  MANAGER: ALL_PERMISSIONS,
  STAFF: new Set([
    Permission.PRODUCTS_VIEW,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_CREATE,
    Permission.ORDERS_UPDATE,
    Permission.REPORTS_ACCESS,
    Permission.PRINTERS_ACCESS,
  ]),
};

export function hasPermission(role: string, ...required: PermissionKey[]): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return required.every((p) => perms.has(p));
}

export const PERMISSIONS_KEY = 'permissions';
export const RequiresPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
