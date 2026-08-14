import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { CachePort } from './cache.port';

const PREFIXO = 'rhti:';

export class RedisCache implements CachePort {
  readonly habilitado = true;

  private readonly log = new Logger(RedisCache.name);
  private readonly redis: Redis;
  private avisouIndisponivel = false;

  constructor(url: string) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      retryStrategy: (tentativas) => Math.min(tentativas * 200, 5_000),
    });

    this.redis.on('error', (erro) => this.registrarFalha(erro));

    this.redis.connect().catch((erro) => this.registrarFalha(erro));
  }

  private registrarFalha(erro: unknown): void {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    if (!this.avisouIndisponivel) {
      this.avisouIndisponivel = true;
      this.log.warn(`Redis indisponível, seguindo sem cache: ${mensagem}`);
      return;
    }

    this.log.debug(`Redis ainda indisponível: ${mensagem}`);
  }

  async obter<T>(chave: string): Promise<T | null> {
    try {
      const bruto = await this.redis.get(PREFIXO + chave);
      if (!bruto) return null;

      return JSON.parse(bruto) as T;
    } catch (erro) {
      this.registrarFalha(erro);
      return null;
    }
  }

  async gravar<T>(chave: string, valor: T, ttlSegundos: number): Promise<void> {
    try {
      await this.redis.set(PREFIXO + chave, JSON.stringify(valor), 'EX', ttlSegundos);
    } catch (erro) {
      this.registrarFalha(erro);
    }
  }

  async limpar(): Promise<void> {
    try {
      const chaves = await this.redis.keys(`${PREFIXO}*`);
      if (chaves.length > 0) await this.redis.del(...chaves);
    } catch (erro) {
      this.registrarFalha(erro);
    }
  }

  async encerrar(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

export class NullCache implements CachePort {
  readonly habilitado = false;

  async obter<T>(_chave: string): Promise<T | null> {
    return null;
  }

  async gravar<T>(_chave: string, _valor: T, _ttlSegundos: number): Promise<void> {
  }

  async limpar(): Promise<void> {
  }
}
