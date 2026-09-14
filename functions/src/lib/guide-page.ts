/**
 * A guide at the address a person reads it, readable by an agent that runs no
 * JavaScript (docs/ui-conventions.md, "The guides").
 *
 * The setup prompt on /agents is one line that sends a coding assistant to
 * /guides/build-agent. That address is the SPA, and a fetch that runs no script
 * would read the home page's fallback instead of the guide. So for a known
 * section the server swaps the fallback for the guide's own markdown text,
 * escaped, and names the markdown twin at /api/guides/:section; a request that
 * prefers text/markdown gets that twin directly. One source, docs/guides/*.md,
 * for the page, the API and the agent.
 */
import { GUIDE_SECTIONS, type GuideSection } from '../content/guides';

const TEXT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const ATTR: Record<string, string> = { ...TEXT, '"': '&quot;', "'": '&#39;' };
const text = (s: string) => s.replace(/[&<>]/g, c => TEXT[c]);
const attr = (s: string) => s.replace(/[&<>"']/g, c => ATTR[c]);

/** True when the Accept header ranks text/markdown at least as high as text/html. */
function prefersMarkdown(accept: string | undefined): boolean {
  if (!accept) return false;
  let md = -1;
  let html = -1;
  for (const part of accept.split(',')) {
    const [type, ...params] = part.split(';').map(p => p.trim());
    const q = params.find(p => p.startsWith('q='));
    const weight = q ? Number(q.slice(2)) : 1;
    if (type === 'text/markdown') md = Math.max(md, weight);
    if (type === 'text/html') html = Math.max(html, weight);
  }
  return md > 0 && md >= html;
}

export function guidePage(
  path: string,
  accept: string | undefined,
  html: string,
  origin: string,
  sections: GuideSection[] = GUIDE_SECTIONS,
): { type: 'html' | 'text/markdown'; body: string } | null {
  const m = /^\/guides\/([a-z0-9-]+)$/.exec(path);
  const guide = m ? sections.find(s => s.id === m[1]) : undefined;
  if (!guide) return null;
  if (prefersMarkdown(accept)) return { type: 'text/markdown', body: guide.content };

  const url = `${origin}/guides/${guide.id}`;
  const markdown = `${origin}/api/guides/${guide.id}`;
  const fallback = [
    '<main class="ssr-fallback" style="max-width:760px;margin:0 auto;padding:3rem 1.25rem;font-family:Inter,system-ui,sans-serif;line-height:1.6;color:#111">',
    `      <h1>${text(guide.title)}</h1>`,
    `      <p>${text(guide.description)}</p>`,
    `      <p>As markdown: <a href="${attr(markdown)}">${text(markdown)}</a></p>`,
    `      <pre style="white-space:pre-wrap;font-family:inherit">${text(guide.content)}</pre>`,
    '    </main>',
  ].join('\n');
  // Function replacements throughout: guide text like "$1" is not a pattern.
  const body = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${text(guide.title)} | Telarchy guides</title>`)
    .replace(/<meta\s+name="description"[^>]*>\s*/g, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
    .replace(
      '</head>',
      () =>
        `    <meta name="description" content="${attr(guide.description)}">\n` +
        `    <link rel="canonical" href="${attr(url)}">\n` +
        `    <link rel="alternate" type="text/markdown" href="${attr(markdown)}" title="${attr(guide.title)}, as markdown">\n` +
        '  </head>',
    )
    .replace(/<main class="ssr-fallback"[\s\S]*?<\/main>/, () => fallback);
  return { type: 'html', body };
}
