import { Module } from '@nestjs/common';
import { AskController } from '../../presentation/http/ask.controller';
import { DemoController } from '../../presentation/http/demo.controller';
import { HealthController } from '../../presentation/http/health.controller';
import { AgentModule } from './agent.module';

@Module({
  imports: [AgentModule],
  controllers: [AskController, DemoController, HealthController],
})
export class HttpModule {}
