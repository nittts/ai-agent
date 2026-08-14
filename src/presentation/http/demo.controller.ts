import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ENV } from '../../infrastructure/config/config.module';
import type { Env } from '../../infrastructure/config/env';
import type { DemoQuestion } from './api-contract';

@Controller('demo')
export class DemoController {
  private readonly log = new Logger(DemoController.name);
  private cached: DemoQuestion[] | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('questions')
  async questions(): Promise<{ questions: DemoQuestion[]; chaosAvailable: boolean }> {
    if (!this.cached) {
      try {
        const path = resolve(process.cwd(), 'eval', 'questions.json');
        const parsed = JSON.parse(await readFile(path, 'utf-8')) as { questions: DemoQuestion[] };
        this.cached = parsed.questions;
      } catch (error) {
        this.log.warn(
          `Could not read eval/questions.json: ${error instanceof Error ? error.message : error}`,
        );
        this.cached = [];
      }
    }

    return { questions: this.cached, chaosAvailable: this.env.CHAOS_ENABLED };
  }
}
