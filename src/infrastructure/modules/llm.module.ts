import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CHAT_MODEL, type ChatModelPort } from '../../application/ports/chat-model.port';
import { GeminiChatModel } from '../llm/gemini/gemini-chat-model';
import { FakeChatModel } from '../llm/fake/fake-chat-model';

@Global()
@Module({
  providers: [
    {
      provide: CHAT_MODEL,
      useFactory: (env: Env): ChatModelPort =>
        env.LLM_PROVIDER === 'fake' ? new FakeChatModel() : new GeminiChatModel(env),
      inject: [ENV],
    },
  ],
  exports: [CHAT_MODEL],
})
export class LlmModule {}
