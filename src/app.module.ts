import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { ConfigModule } from './config/config.module';
import { HttpModule } from './http/http.module';
import { LlmModule } from './llm/llm.module';
import { MockApiModule } from './mock-api/mock-api.module';
import { RetrievalModule } from './retrieval/retrieval.module';

@Module({
  imports: [ConfigModule, LlmModule, RetrievalModule, MockApiModule, AgentModule, HttpModule],
})
export class AppModule {}
