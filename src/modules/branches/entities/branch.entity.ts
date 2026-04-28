export class BranchEntity {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<BranchEntity>) {
    Object.assign(this, partial);
  }
}