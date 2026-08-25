/**
 * The one line an announcement is known by.
 *
 * Announcements are a markdown body with no title. That is on purpose: the
 * record is the body, and a separate title field is a second thing that can
 * disagree with it, on a surface whose whole value is that it cannot be
 * quietly rewritten. So the headline is derived, here, once.
 *
 * The rule is the first sentence of the first line, markdown furniture
 * stripped, cut at 90 characters on a word boundary. The convention that
 * creates is worth saying out loud to whoever writes one: open with a short
 * sentence, because that sentence is what the floor prints.
 */

/** Strip the markdown that would otherwise read as punctuation in a headline. */
function plain(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '') // heading
    .replace(/^\s*>\s?/, '') // quote
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '') // bullet or numbered item
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images, text only
    .replace(/[*_`]/g, '') // emphasis and code ticks
    .trim();
}

/** Sentences, split on terminal punctuation followed by a space. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

export function announcementHeadline(body: string, max = 90): string {
  const line = (body ?? '')
    .split('\n')
    .map(plain)
    .find(l => l.length > 0);
  if (!line) return '';
  if (line.length <= max) return line;

  // Take whole sentences while they are short enough to be a headline. The
  // 25-character floor is what stops an abbreviation ("e.g. ", "16 Oct. ")
  // from producing a stub that says nothing.
  let head = '';
  for (const s of sentences(line)) {
    const next = head ? `${head} ${s}` : s;
    if (head.length >= 25 && next.length > max) break;
    head = next;
    if (head.length >= 25) break;
  }
  if (!head) head = line;
  if (head.length <= max) return head;

  const cut = head.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:]$/, '')}…`;
}
