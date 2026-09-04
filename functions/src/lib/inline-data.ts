/**
 * Inline data for the first paint.
 *
 * The SPA ships one static index.html and used to paint empty, then fetch:
 * the home page needed three waterfall stages (seasons, the public listing,
 * one floor payload per row) before it showed a number. The server now puts
 * the data the first render needs INTO the HTML it serves, as a JSON script
 * element the client reads synchronously before its first fetch:
 *
 *   <script id="telarchy-home" type="application/json">...</script>   on GET /
 *   <script id="telarchy-floor" type="application/json">...</script>  on a share link
 *
 * A JSON script element is inert (the browser never executes
 * application/json), but its body ends at the first `</script>` the parser
 * sees, whatever the JSON quoting says. So every `</` in the serialised JSON
 * becomes `<\/` (identical to JSON.parse, since `\/` is `/`) and `<!--`
 * becomes `<\!--` (same reason: an HTML comment opener inside a script can
 * change how the parser finds the end of the element). Nothing else is
 * touched; the client gets back exactly the object that was serialised.
 */

const OPEN_HOME = '<script id="telarchy-home" type="application/json">';
const OPEN_FLOOR = '<script id="telarchy-floor" type="application/json">';

/** JSON that is safe as the body of a script element. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');
}

function insertBeforeHeadEnd(html: string, element: string): string {
  const at = html.indexOf('</head>');
  if (at < 0) return html;
  return html.slice(0, at) + element + html.slice(at);
}

/** The home payload (GET /api/marketplace/home), inlined for a full load of `/`. */
export function injectHomeData(html: string, payload: unknown): string {
  return insertBeforeHeadEnd(html, `${OPEN_HOME}${scriptSafeJson(payload)}</script>`);
}

export interface FloorHintWorkspace {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
}

/**
 * The four fields a floor page needs to paint its header before the floor
 * payload arrives. Only these four: the workspace row carries the charter
 * and settings, which are the floor payload's to disclose, not the shell's.
 */
export function injectFloorHint(html: string, ws: FloorHintWorkspace): string {
  const hint = { id: ws.id, slug: ws.slug ?? null, name: ws.name, description: ws.description ?? null };
  return insertBeforeHeadEnd(html, `${OPEN_FLOOR}${scriptSafeJson(hint)}</script>`);
}
