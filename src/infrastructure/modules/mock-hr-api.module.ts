import { Module } from '@nestjs/common';
import { ChaosService } from '../../presentation/mock-hr-api/chaos.service';
import { MockHrApiController } from '../../presentation/mock-hr-api/mock-hr-api.controller';

@Module({
  controllers: [MockHrApiController],
  providers: [ChaosService],
  exports: [ChaosService],
})
export class MockHrApiModule {}
