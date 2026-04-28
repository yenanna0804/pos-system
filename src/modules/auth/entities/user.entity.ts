export class UserEntity {
  id: string;
  username: string;
  password: string;
  email: string | null;
  fullName: string | null;
  role: string;
  branchId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}