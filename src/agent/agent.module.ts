import { Module } from '@nestjs/common';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { RhApiClient } from '../tools/rh-api.client';
import { AgentService } from './agent.service';

@Module({
  imports: [RetrievalModule],
  providers: [AgentService, RhApiClient],
  exports: [AgentService],
})
export class AgentModule {}
