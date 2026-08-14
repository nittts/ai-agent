import { Controller, Get, Inject } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { HealthResponse } from './contracts';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  health(): HealthResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      llm: {
        provider: this.env.LLM_PROVIDER,
        chatModel: this.env.LLM_PROVIDER === 'fake' ? null : this.env.GEMINI_CHAT_MODEL,
        embedModel: this.env.LLM_PROVIDER === 'fake' ? null : this.env.GEMINI_EMBED_MODEL,
      },
      cache: {
        enabled: this.env.CACHE_ENABLED && Boolean(this.env.REDIS_URL),
        ttlSeconds: this.env.CACHE_TTL_SECONDS,
      },
      chaosEnabled: this.env.CHAOS_ENABLED,
    };
  }
}
