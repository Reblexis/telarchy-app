import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { PageTopBar } from '../components/PageTopBar';
import { api } from '../lib/api';

const mdStyles: React.CSSProperties = {
  fontSize: '0.875rem',
  color: 'var(--text-secondary)',
  lineHeight: 1.7,
};

interface LegalPageProps {
  /** 'terms' | 'privacy' | 'season-0' | 'season-1' | 'pools/<workspaceId>/<YYYY-MM>' */
  document: string;
}

export function LegalPage({ document }: LegalPageProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getLegalDocument(document)
      .then(setContent)
      .catch(err => console.error('Failed to load legal document', err))
      .finally(() => setLoading(false));
  }, [document]);

  /* Standalone, in the floor's frame (owner decision 2026-08-19: the old
     GUI is gone, and these pages used to borrow the console's page shell).
     Wider than the poster column because a legal document is a document. */
  return (
    <div className="pubws">
      <PageTopBar />
      <div className="pubws-doc" style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.1s' }}>
        <ReactMarkdown
          components={{
            h1: ({ children }) => (
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1.25rem' }}>
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  margin: '2rem 0 0.6rem',
                  paddingBottom: '0.35rem',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                {children}
              </h2>
            ),
            p: ({ children }) => <p style={mdStyles}>{children}</p>,
            li: ({ children }) => <li style={{ ...mdStyles, marginBottom: '0.25rem' }}>{children}</li>,
            ul: ({ children }) => <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>{children}</ol>,
            code: ({ children }) => (
              <code
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  padding: '0.1em 0.35em',
                  fontFamily: 'monospace',
                  fontSize: '0.85em',
                  color: 'var(--text-primary)',
                }}
              >
                {children}
              </code>
            ),
            blockquote: ({ children }) => (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderLeft: '3px solid var(--focus-border)',
                  background: 'var(--focus-bg)',
                  borderRadius: '0 4px 4px 0',
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                  margin: '0.75rem 0',
                }}
              >
                {children}
              </div>
            ),
            strong: ({ children }) => (
              <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>
            ),
            em: ({ children }) => <em style={{ color: 'var(--text-secondary)' }}>{children}</em>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
