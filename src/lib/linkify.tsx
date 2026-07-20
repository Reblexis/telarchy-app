import React from 'react';

// One capture group, so String.split alternates [text, url, text, url, ...].
// Trailing punctuation that commonly follows a pasted URL is excluded.
const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Render plain text with http(s) URLs as clickable links (new tab).
 *  Plain-text splitting only - no HTML parsing, nothing injectable. */
export function linkify(text: string): React.ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
