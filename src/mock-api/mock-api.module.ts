import { Module } from '@nestjs/common';
import { ChaosService } from './chaos.service';
import { MockApiController } from './mock-api.controller';

@Module({
  controllers: [MockApiController],
  providers: [ChaosService],
  exports: [ChaosService],
})
export class MockApiModule {}
