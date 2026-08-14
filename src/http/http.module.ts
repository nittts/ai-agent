import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AskController } from './ask.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [AgentModule],
  controllers: [AskController, HealthController],
})
export class HttpModule {}
