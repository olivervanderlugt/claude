/**
 * MCP server — the distribution wedge.
 *
 * The insight the whole go-to-market rests on: for a vibe-coded app, the *agent* is the
 * developer. Claude Code, Cursor and Lovable write the code, so whatever the agent can
 * read, it will optimise against. An analytics product the agent can query becomes part
 * of the build loop instead of a dashboard nobody opens.
 *
 * So the agent gets first-class tools: read your app's metrics, compare against the
 * cohort, and — the one that spreads on its own — find PII your generated code is leaking.
 *
 * Implemented as bare JSON-RPC over stdio to keep the dependency surface at zero.
 */

import { createInterface } from 'node:readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const API = process.env.PERCENTILE_ENDPOINT ?? 'https://api.percentile.dev';
const KEY = process.env.PERCENTILE_API_KEY ?? '';

const TOOLS = [
  {
    name: 'get_metrics',
    description:
      'Read first-party product metrics for the connected app: event counts, distinct users, funnel steps.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'ISO week or month, e.g. 2026-W30. Defaults to current.' },
      },
    },
  },
  {
    name: 'get_benchmark',
    description:
      'Compare one of this app\'s metrics against the anonymised cohort of comparable AI-built apps. Returns percentile rank and the size of the gap to median.',
    inputSchema: {
      type: 'object',
      properties: {
        metric: { type: 'string', description: 'e.g. activation_rate, d7_retention, checkout_conversion' },
        period: { type: 'string' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'check_pii_leaks',
    description:
      'List personal data this app has been caught sending in event properties, with the property names and rules that matched. Use this to fix the instrumentation at the source.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'explain_suppression',
    description:
      'Explain why a benchmark is unavailable and what would have to change for it to unlock.',
    inputSchema: {
      type: 'object',
      properties: { metric: { type: 'string' } },
      required: ['metric'],
    },
  },
] as const;

async function callApi(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`percentile api ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_metrics':
      return callApi('/v1/insights');
    case 'get_benchmark': {
      const metric = String(args.metric ?? '');
      const period = args.period ? `&period=${encodeURIComponent(String(args.period))}` : '';
      return callApi(`/v1/benchmarks?metric=${encodeURIComponent(metric)}${period}`);
    }
    case 'check_pii_leaks':
      return callApi('/v1/insights/redactions');
    case 'explain_suppression': {
      const result = (await callApi(
        `/v1/benchmarks?metric=${encodeURIComponent(String(args.metric ?? ''))}`,
      )) as { available?: boolean; explanation?: string };
      return {
        available: result.available ?? false,
        explanation: result.explanation ?? 'Benchmark is available.',
      };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`);
}

async function handle(req: JsonRpcRequest): Promise<void> {
  // Notifications carry no id and must never receive a response.
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case 'initialize':
        send({
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'percentile', version: '0.1.0' },
          },
        });
        return;

      case 'tools/list':
        send({ id: req.id, result: { tools: TOOLS } });
        return;

      case 'tools/call': {
        const params = req.params as { name: string; arguments?: Record<string, unknown> };
        const result = await runTool(params.name, params.arguments ?? {});
        send({
          id: req.id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
        });
        return;
      }

      default:
        if (!isNotification) {
          send({ id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
        }
    }
  } catch (error) {
    if (isNotification) return;
    send({
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      },
    });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    send({ id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  void handle(req);
});
