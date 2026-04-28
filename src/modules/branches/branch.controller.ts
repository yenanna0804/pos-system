import { Controller, Get } from '@nestjs/common';
import { BranchService } from './branch.service';

@Controller('branches')
export class BranchController {
  constructor(private branchService: BranchService) {}

  @Get()
  findAll() {
    return this.branchService.findAll();
  }
}