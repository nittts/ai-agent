import { Controller, Get, Inject } from '@nestjs/common';
import { ENV } from '../../infrastructure/config/config.module';
import type { Env } from '../../infrastructure/config/env';
import type { HealthResponse } from './api-contract';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  health(): HealthResponse {
    const usingFake = this.env.LLM_PROVIDER === 'fake';

    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      llm: {
        provider: this.env.LLM_PROVIDER,
        chatModel: usingFake ? null : this.env.GEMINI_CHAT_MODEL,
        embeddingModel: usingFake ? null : this.env.GEMINI_EMBED_MODEL,
      },
      cache: {
        enabled: this.env.CACHE_ENABLED && Boolean(this.env.REDIS_URL),
        ttlSeconds: this.env.CACHE_TTL_SECONDS,
      },
      chaosEnabled: this.env.CHAOS_ENABLED,
    };
  }
}
