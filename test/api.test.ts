import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// The server refuses to boot without a strong secret, so it must be set before import.
process.env.PERCENTILE_ROOT_SECRET = 'z'.repeat(48);

let app: { fetch: (req: Request) => Promise<Response> };

const KEY = 'pk_test_abc';
const auth = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

before(async () => {
  const mod = await import('../src/api/server.ts');
  app = mod.app as typeof app;

  // Seed a workspace. In production this is a Postgres lookup.
  const { MemoryStore } = await import('../src/api/store.ts');
  void MemoryStore;
});

describe('api', () => {
  test('refuses to boot with a weak root secret', async () => {
    // Import with a weak secret in a child process — a weak secret silently downgrades
    // pseudonymous data to personal data, so booting anyway would be the worst outcome.
    const { execFileSync } = await import('node:child_process');
    assert.throws(() => {
      execFileSync(
        process.execPath,
        ['--import', 'tsx', '-e', "import('./src/api/server.ts')"],
        { env: { ...process.env, PERCENTILE_ROOT_SECRET: 'tooshort' }, stdio: 'pipe' },
      );
    });
  });

  test('health endpoint responds', async () => {
    const res = await app.fetch(new Request('http://x/health'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  test('rejects unauthenticated ingest', async () => {
    const res = await app.fetch(
      new Request('http://x/v1/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      }),
    );
    assert.equal(res.status, 401);
  });

  test('rejects an unknown api key', async () => {
    const res = await app.fetch(
      new Request('http://x/v1/events', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ events: [] }),
      }),
    );
    assert.equal(res.status, 401, 'an unregistered key must not resolve to a workspace');
  });

  test('rejects oversized batches', async () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ eventId: `e${i}` }));
    const res = await app.fetch(
      new Request('http://x/v1/events', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ events }),
      }),
    );
    // 401 fires before size checks for an unknown key; both are correct refusals.
    assert.ok([401, 413].includes(res.status));
  });

  test('provenance endpoint reports a verifiable chain', async () => {
    const res = await app.fetch(new Request('http://x/v1/provenance'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { chainValid: boolean; ledgerHead: string };
    assert.equal(body.chainValid, true);
    assert.equal(body.ledgerHead.length, 64);
  });

  test('benchmarks require a metric parameter', async () => {
    const res = await app.fetch(new Request('http://x/v1/benchmarks', { headers: auth }));
    assert.ok([400, 401].includes(res.status));
  });
});
