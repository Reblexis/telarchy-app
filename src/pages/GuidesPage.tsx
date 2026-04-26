import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface GuideSection {
  id: string;
  title: string;
  description: string;
  path: string;
}

const mdStyles: React.CSSProperties = {
  fontSize: '0.875rem',
  color: 'var(--text-secondary)',
  lineHeight: 1.7,
};

export function GuidesPage() {
  const { section: routeSection } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const [sections, setSections] = useState<GuideSection[]>([]);
  const [active, setActive] = useState<string>(routeSection ?? '');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    fetch(`${API_BASE}/api/guides`)
      .then(r => r.json())
      .then((data: GuideSection[]) => {
        setSections(data);
        const fallback = data.length > 0 ? data[0].id : '';
        const known = data.some(s => s.id === routeSection);
        if (routeSection && known) setActive(routeSection);
        else if (!active) setActive(fallback);
      })
      .catch(err => console.error('Failed to load guide index', err));
  }, [routeSection]);

  // Keep the URL in sync with the active section so /guides/<id> works for
  // both deep-links (handled by routeSection above) and the in-page nav.
  useEffect(() => {
    if (active && active !== routeSection) navigate(`/guides/${active}`, { replace: true });
  }, [active, routeSection, navigate]);

  useEffect(() => {
    if (!active) return;
    if (cache.current.has(active)) {
      setContent(cache.current.get(active)!);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/api/guides/${active}`)
      .then(r => r.text())
      .then(text => {
        cache.current.set(active, text);
        setContent(text);
      })
      .catch(err => console.error('Failed to load guide section', err))
      .finally(() => setLoading(false));
  }, [active]);

  return (
    <div className="page-content">
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Guides</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
          How Telarchy works: metrics, forecasting, markets, and the decision loop.
        </p>

        <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'flex-start' }}>
          <nav style={{ flexShrink: 0, width: 160, position: 'sticky', top: '2rem' }}>
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8125rem',
                  fontWeight: active === s.id ? 600 : 400,
                  color: active === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: active === s.id ? 'var(--bg-secondary)' : 'none',
                  border: 'none',
                  borderLeft: `2px solid ${active === s.id ? 'var(--focus-border)' : 'transparent'}`,
                  borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                  cursor: 'pointer',
                  marginBottom: '0.1rem',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {s.title}
              </button>
            ))}
          </nav>

          <div style={{ flex: 1, minWidth: 0, opacity: loading ? 0.5 : 1, transition: 'opacity 0.1s' }}>
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1.5rem' }}>
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: '2rem 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', margin: '1.25rem 0 0.4rem' }}>
                    {children}
                  </h3>
                ),
                p: ({ children }) => <p style={mdStyles}>{children}</p>,
                li: ({ children }) => <li style={{ ...mdStyles, marginBottom: '0.25rem' }}>{children}</li>,
                ul: ({ children }) => <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>{children}</ol>,
                code: ({ children, className }) => {
                  const isBlock = className?.startsWith('language-') || String(children).includes('\n');
                  if (isBlock) {
                    return (
                      <pre style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--text-primary)', overflowX: 'auto', margin: '0.75rem 0', lineHeight: 1.6 }}>
                        <code>{children}</code>
                      </pre>
                    );
                  }
                  return (
                    <code style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.1em 0.35em', fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--text-primary)' }}>
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                blockquote: ({ children }) => (
                  <div style={{ padding: '0.75rem 1rem', borderLeft: '3px solid var(--focus-border)', background: 'var(--focus-bg)', borderRadius: '0 4px 4px 0', fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0.75rem 0' }}>
                    {children}
                  </div>
                ),
                strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
