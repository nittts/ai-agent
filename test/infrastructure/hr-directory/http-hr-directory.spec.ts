import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { HttpHrDirectory } from '../../../src/infrastructure/hr-directory/http-hr-directory';
import {
  ContractViolationError,
  RecordNotFoundError,
} from '../../../src/application/ports/hr-directory.port';
import { loadEnv, type Env } from '../../../src/infrastructure/config/env';
import { vacationBalances } from '../../../src/presentation/mock-hr-api/seed';

describe('HttpHrDirectory', () => {
  let server: Server;
  let env: Env;

  let respond: (url: string) => { status: number; body: unknown; delayMs?: number };
  let calls: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      calls.push(req.url ?? '');
      const { status, body, delayMs } = respond(req.url ?? '');

      const send = () => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (delayMs) setTimeout(send, delayMs);
      else send();
    });

    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    env = loadEnv({
      LLM_PROVIDER: 'fake',
      HR_API_BASE_URL: `http://127.0.0.1:${port}`,
      TOOL_TIMEOUT_MS: '150',
      TOOL_MAX_RETRIES: '2',
    } as NodeJS.ProcessEnv);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    calls = [];
    respond = () => ({ status: 200, body: vacationBalances[1042] });
  });

  const client = () => new HttpHrDirectory(env);

  it('returns valid data with its provenance', async () => {
    const result = await client().vacationBalance(1042);

    expect(result.data.availableDays).toBe(18);
    expect(result.source.endpoint).toBe('GET /employees/1042/vacation-balance');
    expect(result.source.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects a 200 response that violates the contract', async () => {
    respond = () => ({ status: 200, body: { employeeId: 1042, availableDay: 18 } });

    await expect(client().vacationBalance(1042)).rejects.toBeInstanceOf(ContractViolationError);
  });

  it('names the field that broke the contract', async () => {
    respond = () => ({ status: 200, body: { ...vacationBalances[1042], availableDays: 'eighteen' } });

    await expect(client().vacationBalance(1042)).rejects.toThrowError(/availableDays/);
  });

  it('treats 404 as a record error and does NOT retry', async () => {
    respond = () => ({ status: 404, body: { error: 'not_found', message: 'Employee 9999 missing.' } });

    await expect(client().vacationBalance(9999)).rejects.toBeInstanceOf(RecordNotFoundError);

    expect(calls).toHaveLength(1);
  });

  it('retries a 5xx and succeeds on the next attempt', async () => {
    let n = 0;
    respond = () => {
      n++;
      return n === 1
        ? { status: 500, body: { error: 'boom' } }
        : { status: 200, body: vacationBalances[1042] };
    };

    await expect(client().vacationBalance(1042)).resolves.toMatchObject({
      data: { availableDays: 18 },
    });
    expect(calls).toHaveLength(2);
  });

  it('honours the timeout and gives up after its attempts', async () => {
    respond = () => ({ status: 200, body: vacationBalances[1042], delayMs: 400 });

    await expect(client().vacationBalance(1042)).rejects.toThrowError(/Timed out/);
    expect(calls.length).toBeGreaterThan(1);
  });

  it('validates the contract of every resource, not just vacation', async () => {
    respond = () => ({ status: 200, body: { anything: 'else' } });

    await expect(client().benefits(1042)).rejects.toBeInstanceOf(ContractViolationError);
    await expect(client().hoursBank(1042)).rejects.toBeInstanceOf(ContractViolationError);
    await expect(client().ticket(8871)).rejects.toBeInstanceOf(ContractViolationError);
  });
});
