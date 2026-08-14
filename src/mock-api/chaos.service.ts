import { Injectable } from '@nestjs/common';

export const MODOS_CHAOS = ['ok', '500', 'timeout', 'contrato'] as const;
export type ModoChaos = (typeof MODOS_CHAOS)[number];

@Injectable()
export class ChaosService {
  private modo: ModoChaos = 'ok';

  definir(modo: ModoChaos): void {
    this.modo = modo;
  }

  atual(): ModoChaos {
    return this.modo;
  }

  estaSaudavel(): boolean {
    return this.modo === 'ok';
  }
}
