import { Module, type OnModuleInit, Inject } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AnswerQuestionUseCase } from '../../application/use-cases/answer-question.use-case';
import { AgentModule } from './agent.module';

export const MCP_SETUP = Symbol('MCP_SETUP');

@Module({
  imports: [AgentModule],
  providers: [
    {
      provide: MCP_SETUP,
      useFactory: (env: Env, answerQuestion: AnswerQuestionUseCase) => ({
        answerQuestion,
        corpusPath: env.CORPUS_PATH,
      }),
      inject: [ENV, AnswerQuestionUseCase],
    },
  ],
  exports: [MCP_SETUP],
})
export class McpModule implements OnModuleInit {
  constructor(@Inject(MCP_SETUP) private readonly setup: unknown) {}

  onModuleInit(): void {
    void this.setup;
  }
}
