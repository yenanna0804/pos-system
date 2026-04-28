export type CurrentUser = {
  id: string;
  username: string;
  fullName: string | null;
  role: string;
  branchId: string | null;
  branchName: string | null;
};

export type RoleName = 'ADMIN' | 'MANAGER' | 'STAFF';
