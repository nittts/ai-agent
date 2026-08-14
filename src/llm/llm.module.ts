import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { criarChatModel, type ChatModelPort } from './chat-model';
import { FakeChatModel } from './fake-chat-model';

export const CHAT_MODEL = Symbol('CHAT_MODEL');

@Global()
@Module({
  providers: [
    {
      provide: CHAT_MODEL,
      useFactory: (env: Env): ChatModelPort => criarChatModel(env, new FakeChatModel()),
      inject: [ENV],
    },
  ],
  exports: [CHAT_MODEL],
})
export class LlmModule {}
