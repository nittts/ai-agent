import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AskController } from './ask.controller';
import { DemoController } from './demo.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [AgentModule],
  controllers: [AskController, DemoController, HealthController],
})
export class HttpModule {}
