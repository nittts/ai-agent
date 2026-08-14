import { Injectable } from '@nestjs/common';

export const CHAOS_MODES = ['ok', '500', 'timeout', 'contract'] as const;
export type ChaosMode = (typeof CHAOS_MODES)[number];

@Injectable()
export class ChaosService {
  private mode: ChaosMode = 'ok';

  set(mode: ChaosMode): void {
    this.mode = mode;
  }

  current(): ChaosMode {
    return this.mode;
  }

  isHealthy(): boolean {
    return this.mode === 'ok';
  }
}
