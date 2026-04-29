import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface GuideSection {
  id: string;
  title: string;
  description: string;
  category: GuideCategoryId;
  order: number;
  path: string;
}

type GuideCategoryId = 'start' | 'metrics' | 'forecast' | 'api';

interface GuideCategory {
  id: GuideCategoryId;
  title: string;
  description: string;
}

const mdStyles: React.CSSProperties = {
  fontSize: '0.9rem',
  color: 'var(--text-secondary)',
  lineHeight: 1.7,
  margin: '0.75rem 0',
};

export function GuidesPage() {
  const { section: routeSection } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const [sections, setSections] = useState<GuideSection[]>([]);
  const [categories, setCategories] = useState<GuideCategory[]>([]);
  const [active, setActive] = useState<string>(routeSection ?? '');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState('');
  const cache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${API_BASE}/api/guides`).then(r => r.json()),
      fetch(`${API_BASE}/api/guides/_categories`).then(r => r.json()),
    ])
      .then(([secData, catData]) => {
        if (cancelled) return;
        const secs = (secData as GuideSection[]) ?? [];
        setSections(secs);
        setCategories((catData as GuideCategory[]) ?? []);
        const known = secs.some(s => s.id === routeSection);
        const fallback = secs.length > 0 ? secs[0].id : '';
        if (routeSection && known) setActive(routeSection);
        else if (!active) setActive(fallback);
      })
      .catch(err => {
        console.error('Failed to load guide index', err);
        if (!cancelled) setBootError('Could not load the guide index. Reload the page; if it keeps failing, the API may be down.');
      });
    return () => { cancelled = true; };
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
        // Scroll to top on section change so long pages don't strand the
        // reader mid-content.
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      })
      .catch(err => console.error('Failed to load guide section', err))
      .finally(() => setLoading(false));
  }, [active]);

  const sectionsByCategory = useMemo(() => {
    const map = new Map<GuideCategoryId, GuideSection[]>();
    for (const s of sections) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return map;
  }, [sections]);

  // Linear sequence (matches sidebar order) for prev/next at the bottom of
  // each section. Helps readers walk the guides without bouncing back to
  // the sidebar.
  const linear = useMemo(() => {
    const out: GuideSection[] = [];
    for (const cat of categories) {
      const list = sectionsByCategory.get(cat.id) ?? [];
      out.push(...list);
    }
    return out;
  }, [categories, sectionsByCategory]);

  const activeIndex = linear.findIndex(s => s.id === active);
  const activeSection = activeIndex >= 0 ? linear[activeIndex] : null;
  const activeCategory = activeSection ? categories.find(c => c.id === activeSection.category) : null;
  const prev = activeIndex > 0 ? linear[activeIndex - 1] : null;
  const next = activeIndex >= 0 && activeIndex < linear.length - 1 ? linear[activeIndex + 1] : null;

  return (
    <div className="page-content">
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        {bootError && (
          <div className="message error show" style={{ marginBottom: '1rem' }}>{bootError}</div>
        )}

        <div className="guides-layout" style={{ display: 'flex', gap: '3rem', alignItems: 'flex-start' }}>
          <nav className="guides-nav" style={{ flexShrink: 0, width: 220, position: 'sticky', top: '2rem' }}>
            <div style={{ marginBottom: '1.25rem' }}>
              <h1 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 0.2rem', letterSpacing: '-0.01em' }}>Guides</h1>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: 0 }}>How Telarchy works.</p>
            </div>
            {categories.map(cat => {
              const list = sectionsByCategory.get(cat.id) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={cat.id} style={{ marginBottom: '1.1rem' }}>
                  <div className="guides-cat-label" style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    padding: '0 0.75rem',
                    marginBottom: '0.35rem',
                  }} title={cat.description}>
                    {cat.title}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {list.map(s => {
                      const isActive = active === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setActive(s.id)}
                          className="guides-nav-item"
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '0.32rem 0.75rem',
                            fontSize: '0.82rem',
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                            background: isActive ? 'var(--bg-secondary)' : 'none',
                            border: 'none',
                            borderLeft: `2px solid ${isActive ? 'var(--focus-border)' : 'transparent'}`,
                            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                            cursor: 'pointer',
                            transition: 'all var(--transition-fast)',
                          }}
                          title={s.description}
                        >
                          {s.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <article className="guides-article" style={{ flex: 1, minWidth: 0, opacity: loading ? 0.5 : 1, transition: 'opacity 0.1s', paddingBottom: '4rem' }}>
            {activeCategory && activeSection && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span>{activeCategory.title}</span>
                <span aria-hidden>›</span>
                <span style={{ color: 'var(--text-secondary)' }}>{activeSection.title}</span>
              </div>
            )}
            {activeSection && (
              <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 1.5rem' }}>
                {activeSection.description}
              </p>
            )}

            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 style={{ fontSize: '1.6rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 1.5rem', letterSpacing: '-0.02em' }}>
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: '2.25rem 0 0.6rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: '1.5rem 0 0.4rem' }}>
                    {children}
                  </h3>
                ),
                p: ({ children }) => <p style={mdStyles}>{children}</p>,
                li: ({ children }) => <li style={{ ...mdStyles, marginBottom: '0.25rem', margin: '0.2rem 0' }}>{children}</li>,
                ul: ({ children }) => <ul style={{ paddingLeft: '1.5rem', margin: '0.6rem 0' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ paddingLeft: '1.5rem', margin: '0.6rem 0' }}>{children}</ol>,
                table: ({ children }) => (
                  <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead>{children}</thead>,
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => <tr style={{ borderBottom: '1px solid var(--border-color)' }}>{children}</tr>,
                th: ({ children }) => <th style={{ textAlign: 'left', padding: '0.45rem 0.6rem', fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.78rem' }}>{children}</th>,
                td: ({ children }) => <td style={{ padding: '0.45rem 0.6rem', color: 'var(--text-secondary)', verticalAlign: 'top' }}>{children}</td>,
                code: ({ children, className }) => {
                  const isBlock = className?.startsWith('language-') || String(children).includes('\n');
                  if (isBlock) {
                    return (
                      <pre style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.85rem 1rem', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-primary)', overflowX: 'auto', margin: '0.85rem 0', lineHeight: 1.6 }}>
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
                  <div style={{ padding: '0.75rem 1rem', borderLeft: '3px solid var(--focus-border)', background: 'var(--focus-bg)', borderRadius: '0 4px 4px 0', fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '1rem 0' }}>
                    {children}
                  </div>
                ),
                strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>,
                a: ({ children, href }) => {
                  // Internal links keep client-side routing.
                  if (href && href.startsWith('/')) {
                    return <Link to={href} style={{ color: 'var(--focus-border)', textDecoration: 'underline' }}>{children}</Link>;
                  }
                  return <a href={href} style={{ color: 'var(--focus-border)', textDecoration: 'underline' }} target="_blank" rel="noreferrer">{children}</a>;
                },
              }}
            >
              {content}
            </ReactMarkdown>

            {(prev || next) && (
              <div className="guides-pagination" style={{
                display: 'flex',
                gap: '0.75rem',
                marginTop: '3rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid var(--border-color)',
              }}>
                {prev ? (
                  <button
                    type="button"
                    onClick={() => setActive(prev.id)}
                    className="guides-pagination-btn"
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      padding: '0.85rem 1rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'transparent',
                      cursor: 'pointer',
                      transition: 'border-color var(--transition-fast)',
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: '0.15rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>← Previous</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{prev.title}</div>
                  </button>
                ) : <div style={{ flex: 1 }} />}
                {next ? (
                  <button
                    type="button"
                    onClick={() => setActive(next.id)}
                    className="guides-pagination-btn"
                    style={{
                      flex: 1,
                      textAlign: 'right',
                      padding: '0.85rem 1rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'transparent',
                      cursor: 'pointer',
                      transition: 'border-color var(--transition-fast)',
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: '0.15rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next →</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{next.title}</div>
                  </button>
                ) : <div style={{ flex: 1 }} />}
              </div>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
