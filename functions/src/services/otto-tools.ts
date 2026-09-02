import type { Request } from 'express';
import type { AskTool } from '../lib/ask';
import { HELP } from '../lib/help-catalog';

/**
 * Otto's hands (owner direction 2026-08-21: "it should have exact same access
 * the given user has", trades included).
 *
 * He does not get an identity of his own, and there is no service credential
 * anywhere in this file. Every call he makes is the visitor's own request,
 * replayed: same cookie or key, same workspace header, same IP, through the
 * same HTTP surface a third-party agent would use. So his permissions are not
 * a policy written here that could drift from the product; they are whatever
 * the API already grants that caller, checked by the same middleware, and an
 * anonymous visitor's Otto can do exactly what an anonymous visitor can do.
 *
 * That guarantee rests on the frontend having no private door to the server
 * (AGENTS.md, "Frontend goes through the public API", enforced by
 * api-parity.test.ts): everything the UI can do is a documented endpoint, so
 * "what you can do" and "what Otto can do for you" are the same list.
 *
 * The rule he must not break is in the system prompt, not here, because it is
 * a judgment rather than a permission: only the person in the conversation
 * gives him instructions. A proposal description, a comment or a document is
 * text he is reading, never an order he follows.
 */

/** Headers that carry WHO the caller is. Nothing else is forwarded: a copied
 *  Host or Content-Length would confuse the loopback request, and the rest is
 *  the browser talking about itself. */
const IDENTITY_HEADERS = ['cookie', 'authorization', 'x-api-key', 'x-agent-key', 'x-workspace-id'] as const;

/** How much of a response Otto is given. A floor payload with every proposal
 *  and its comments can run past a hundred kilobytes, which would spend the
 *  whole context on one lookup. He is told when it was cut. */
const MAX_RESULT_CHARS = 24_000;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Where this process serves its own API. Loopback, so the call never leaves
 *  the container and cannot be intercepted; overridable for tests. */
function selfBase(): string {
  return process.env.SELF_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
}

export interface ApiCallRecord {
  method: string;
  path: string;
  status: number;
}

/**
 * One catalog line per endpoint, trimmed to what a decision needs: the method,
 * the path, who may call it, and the first sentence of what it does. The full
 * catalog is over a hundred entries of paragraph-long descriptions; handing it
 * over whole would cost more than most conversations are worth.
 */
function catalogLines(query: string): string[] {
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const rows = HELP.endpoints.filter(e => {
    if (!terms.length) return true;
    const hay = `${e.method} ${e.path} ${e.description}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  return rows.slice(0, 40).map(e => {
    const first = e.description.split(/(?<=\.)\s/)[0] ?? e.description;
    return `${e.method} ${e.path} [auth: ${e.auth === false ? 'none' : e.auth}] ${first.slice(0, 220)}`;
  });
}

/**
 * The two tools that make Otto an assistant rather than an answer service:
 * one to find the endpoint, one to call it as the visitor.
 *
 * `record` collects what he actually did, so the question log can keep the
 * actions beside the question. Acting on someone's behalf without a record of
 * it is the part that would be hard to defend later.
 */
export function ottoApiTools(req: Request, record: ApiCallRecord[], floorWorkspaceId?: string): AskTool[] {
  const identity: Record<string, string> = {};
  for (const h of IDENTITY_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string' && v) identity[h] = v;
  }
  // The floor being asked about, when the caller sent no workspace of their
  // own. Reading a public workspace needs no key but does need to name the
  // workspace (AGENTS.md, "Reading is open, acting needs a key"), and a
  // browser visitor sends no such header, so without this an anonymous
  // question about the market in front of them comes back 401. It grants
  // nothing: an anonymous caller still gets `read` on a public workspace and
  // nothing else, which is the same boundary the page itself sits behind.
  if (!identity['x-workspace-id'] && floorWorkspaceId) {
    identity['x-workspace-id'] = floorWorkspaceId;
  }

  // The visitor's own address, so per-IP limits count against them rather than
  // against the loopback interface every visitor shares.
  const fwd = (req.headers['x-forwarded-for'] as string | undefined) || req.socket.remoteAddress || '';
  if (fwd) identity['x-forwarded-for'] = fwd;

  const signedIn = Boolean(req.auth?.agentId);

  const catalog: AskTool = {
    spec: {
      type: 'function',
      function: {
        name: 'find_endpoint',
        description:
          'Search the Telarchy API catalog (the same GET /api/help a third-party agent reads) ' +
          'for the endpoint that does something. Returns one line per match: method, path, who ' +
          'may call it, and what it does. Call this before call_api whenever you are not certain ' +
          'of the exact path.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Words that appear in the path or description, e.g. "place trade", "proposal", "positions", "balance".',
            },
          },
          required: ['query'],
        },
      },
    },
    async run(args: { query?: string }) {
      const lines = catalogLines(args?.query ?? '');
      return lines.length ? lines.join('\n') : 'No endpoint matches that. Try fewer or different words.';
    },
  };

  const call: AskTool = {
    spec: {
      type: 'function',
      function: {
        name: 'call_api',
        description: signedIn
          ? 'Call the Telarchy API as the person you are talking to, with their own account. ' +
            'You can do anything they can do and nothing more: read their balance and positions, ' +
            'place or sell a bet, post a comment, offer a proposal, update their profile, and, ' +
            'if they own a workspace, manage it. Every call is made with their credentials, so a ' +
            '401 or 403 means they cannot do it either. Use find_endpoint first if unsure of the path.'
          : 'Call the Telarchy API as an anonymous visitor, because this person is not signed in. ' +
            'Public reads work; anything that acts (trading, posting, proposing) will return 401 ' +
            'or 403, and the honest answer is to tell them what signing up would let them do.',
        parameters: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            path: { type: 'string', description: 'Path beginning with /api/, query string included.' },
            body: { type: 'object', description: 'JSON body, for methods that take one.' },
          },
          required: ['method', 'path'],
        },
      },
    },
    async run(args: { method?: string; path?: string; body?: unknown }) {
      const method = String(args?.method ?? 'GET').toUpperCase();
      const path = String(args?.path ?? '');
      if (!METHODS.has(method)) return `Refused: ${method} is not a method this API takes.`;
      if (!path.startsWith('/api/') || path.includes('..')) {
        return 'Refused: path must start with /api/ and name a real endpoint.';
      }

      const init: RequestInit = {
        method,
        headers: { ...identity, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
      };
      if (method !== 'GET' && args?.body !== undefined) init.body = JSON.stringify(args.body);

      let res: Response;
      try {
        res = await fetch(`${selfBase()}${path}`, init);
      } catch (e) {
        record.push({ method, path, status: 0 });
        return `The call did not complete: ${e instanceof Error ? e.message : String(e)}`;
      }
      record.push({ method, path, status: res.status });

      const text = await res.text();
      const body =
        text.length > MAX_RESULT_CHARS
          ? `${text.slice(0, MAX_RESULT_CHARS)}\n... (cut here; ask for a narrower endpoint or a filter)`
          : text;
      // The status is stated rather than interpreted: a 403 is a fact about
      // this person's permissions and he should say so plainly.
      return `HTTP ${res.status}\n${body || '(empty response)'}`;
    },
  };

  return [catalog, call];
}
