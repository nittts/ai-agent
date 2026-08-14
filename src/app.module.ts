import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { ConfigModule } from './config/config.module';
import { LlmModule } from './llm/llm.module';
import { MockApiModule } from './mock-api/mock-api.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { HealthController } from './http/health.controller';

@Module({
  imports: [ConfigModule, LlmModule, RetrievalModule, MockApiModule, AgentModule],
  controllers: [HealthController],
})
export class AppModule {}
