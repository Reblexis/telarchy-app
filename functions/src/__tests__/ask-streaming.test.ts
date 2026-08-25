/**
 * Otto's answer arriving in pieces (owner direction 2026-08-24: "so i dont
 * have to wait").
 *
 * Three things bite when a chat completion is streamed, and all three are
 * silent:
 *
 *  - Frames split across reads. A network chunk ends wherever it ends, so a
 *    parser that assumes whole frames drops words at random.
 *  - Tool-call arguments come down the same channel as prose. Showing them
 *    means a reader watches JSON assemble itself, which is Otto thinking out
 *    loud in a language they did not ask for.
 *  - Usage only arrives when asked for, and without it every streamed answer
 *    reports no cost at all.
 */

import { type AskTool, askAboutWorkspace } from '../lib/ask';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.AI_GATEWAY_API_KEY;

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = 'test-key';
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = ORIGINAL_KEY;
});

/** A gateway that hands back exactly these byte chunks. */
function streamOf(chunks: string[], capture?: (body: Record<string, unknown>) => void) {
  global.fetch = (async (_url: unknown, init: { body: string }) => {
    capture?.(JSON.parse(init.body));
    const encoder = new TextEncoder();
    return {
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
    } as unknown as Response;
  }) as unknown as typeof global.fetch;
}

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content: string) => frame({ choices: [{ delta: { content } }] });

describe('a streamed answer', () => {
  test('reaches the caller in pieces and returns whole', async () => {
    const seen: string[] = [];
    streamOf([delta('Monthly '), delta('disputes'), delta(', then.'), 'data: [DONE]\n\n']);

    const res = await askAboutWorkspace('BRIEF', [{ role: 'user', content: 'hi' }], [], {
      onDelta: t => seen.push(t),
    });

    expect(seen).toEqual(['Monthly ', 'disputes', ', then.']);
    expect(res.answer).toBe('Monthly disputes, then.');
  });

  test('survives a frame split across two reads', async () => {
    // The network cuts wherever it likes; this one lands mid-JSON.
    const whole = delta('Monthly disputes.');
    streamOf([whole.slice(0, 24), whole.slice(24), 'data: [DONE]\n\n']);
    const seen: string[] = [];
    const res = await askAboutWorkspace('BRIEF', [{ role: 'user', content: 'hi' }], [], {
      onDelta: t => seen.push(t),
    });
    expect(seen).toEqual(['Monthly disputes.']);
    expect(res.answer).toBe('Monthly disputes.');
  });

  test('asks for usage, or a streamed answer costs nothing on the record', async () => {
    let body: Record<string, unknown> = {};
    streamOf(
      [delta('ok'), frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.002 } })],
      b => {
        body = b;
      },
    );
    const res = await askAboutWorkspace('BRIEF', [{ role: 'user', content: 'hi' }], [], { onDelta: () => {} });
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(res.usage.costUsd).toBe(0.002);
    expect(res.usage.output).toBe(4);
  });

  test('a malformed frame is skipped rather than failing the answer', async () => {
    streamOf([delta('Still '), 'data: {oops\n\n', delta('here.')]);
    const res = await askAboutWorkspace('BRIEF', [{ role: 'user', content: 'hi' }], [], { onDelta: () => {} });
    expect(res.answer).toBe('Still here.');
  });
});

describe('tool calls while streaming', () => {
  test('their arguments never reach the reader, and the tool still runs', async () => {
    const calls: unknown[] = [];
    const tool: AskTool = {
      spec: {
        type: 'function',
        function: { name: 'look', description: 'look', parameters: { type: 'object', properties: {} } },
      },
      run: async (args: unknown) => {
        calls.push(args);
        return 'the answer is 41';
      },
    };

    let round = 0;
    global.fetch = (async () => {
      round += 1;
      const encoder = new TextEncoder();
      // Round one asks for the tool, in fragments, exactly as a gateway
      // splits an arguments string. Round two speaks.
      const chunks =
        round === 1
          ? [
              frame({
                choices: [
                  { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'look', arguments: '{"q":' } }] } },
                ],
              }),
              frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"disputes"}' } }] } }] }),
              frame({ choices: [{ finish_reason: 'tool_calls', delta: {} }] }),
            ]
          : [delta('It is 41.')];
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
          start(c) {
            for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
            c.close();
          },
        }),
      } as unknown as Response;
    }) as unknown as typeof global.fetch;

    const seen: string[] = [];
    const res = await askAboutWorkspace('BRIEF', [{ role: 'user', content: 'how many?' }], [tool], {
      onDelta: t => seen.push(t),
    });

    // The arguments were reassembled across chunks and handed to the tool.
    expect(calls).toEqual([{ q: 'disputes' }]);
    // And the reader saw prose only.
    expect(seen.join('')).toBe('It is 41.');
    expect(res.answer).toBe('It is 41.');
  });
});
