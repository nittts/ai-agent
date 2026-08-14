import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { MockApiModule } from './mock-api/mock-api.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { HealthController } from './http/health.controller';

@Module({
  imports: [ConfigModule, RetrievalModule, MockApiModule],
  controllers: [HealthController],
})
export class AppModule {}
