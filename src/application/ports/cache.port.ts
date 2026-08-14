export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;

  clear(): Promise<void>;
  readonly enabled: boolean;
}

export const CACHE = Symbol('CACHE');
