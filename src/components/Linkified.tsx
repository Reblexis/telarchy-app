import type { ReactNode } from 'react';

/**
 * Links in prose are links (docs/ui-conventions.md, "Links in prose are
 * links"): a URL typed into a description renders as an anchor, new tab, no
 * referrer. Trailing punctuation stays text, and a closing bracket links only
 * when the address opened one. Line breaks are the caller's (white-space).
 */
export function linkify(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>"]+)/g).map((part, i) => {
    if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>;
    let url = part;
    let tail = '';
    for (;;) {
      const last = url.slice(-1);
      if (/[.,;:!?'"]/.test(last)) {
        url = url.slice(0, -1);
        tail = last + tail;
        continue;
      }
      if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
        url = url.slice(0, -1);
        tail = last + tail;
        continue;
      }
      break;
    }
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
        {tail}
      </span>
    );
  });
}

export function Linkified({ text }: { text: string }) {
  return <>{linkify(text)}</>;
}
