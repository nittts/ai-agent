import { Module } from '@nestjs/common';
import { ConfigModule } from './infrastructure/config/config.module';
import { CacheModule } from './infrastructure/modules/cache.module';
import { LlmModule } from './infrastructure/modules/llm.module';
import { RetrievalModule } from './infrastructure/modules/retrieval.module';
import { AgentModule } from './infrastructure/modules/agent.module';
import { HttpModule } from './infrastructure/modules/http.module';
import { MockHrApiModule } from './infrastructure/modules/mock-hr-api.module';

@Module({
  imports: [
    ConfigModule,
    CacheModule,
    LlmModule,
    RetrievalModule,
    AgentModule,
    HttpModule,
    MockHrApiModule,
  ],
})
export class AppModule {}
