import { Controller, Get } from '@nestjs/common';
import { BranchService } from './branch.service';
import { Public } from '../../common/auth.guard';

@Public()
@Controller('branches')
export class BranchController {
  constructor(private branchService: BranchService) {}

  @Get()
  findAll() {
    return this.branchService.findAll();
  }
}