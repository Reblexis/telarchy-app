import { type CSSProperties, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export type DepositAddressInfo = {
  address: string;
  usdcContract: string;
  chain: string;
  asset: string;
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div style={{ marginBottom: '0.65rem' }}>
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--text-tertiary)',
          marginBottom: '0.2rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <code style={{ fontSize: '0.78rem', wordBreak: 'break-all', flex: 1, minWidth: 0 }}>{value}</code>
        <button type="button" onClick={copy} className="btn-copy" style={{ flexShrink: 0 }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

const mdBox: CSSProperties = {
  fontSize: '0.875rem',
  color: 'var(--text-secondary)',
  lineHeight: 1.65,
  marginBottom: '1rem',
};

/**
 * Top-up help: narrative from GET /api/guides/credits; live values only from GET /api/agents/deposit-address.
 * No client-side rules beyond displaying those API responses.
 */
export function TopUpCreditsInstructions({ deposit }: { deposit: DepositAddressInfo | null }) {
  const [guideMd, setGuideMd] = useState('');
  const [guideLoading, setGuideLoading] = useState(true);
  const [guideErr, setGuideErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGuideLoading(true);
    setGuideErr(false);
    api
      .getGuide('credits')
      .then(text => {
        if (!cancelled) setGuideMd(text);
      })
      .catch(() => {
        if (!cancelled) setGuideErr(true);
      })
      .finally(() => {
        if (!cancelled) setGuideLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!deposit) {
    return (
      <div
        style={{
          marginBottom: '1rem',
          padding: '0.75rem',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
        }}
      >
        Top-up is unavailable: <code style={{ fontSize: '0.78rem' }}>GET /api/agents/deposit-address</code> did not
        return a treasury (host not configured for on-chain deposits).
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: '1rem',
        padding: '0.85rem 1rem',
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.65rem' }}>
        Instructions below are the same as <code style={{ fontSize: '0.72rem' }}>GET /api/guides/credits</code>
        {' · '}
        <Link to="/guides" style={{ color: 'var(--focus-border)' }}>
          Guides
        </Link>
      </div>

      {guideLoading && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
          Loading instructions…
        </p>
      )}
      {guideErr && (
        <p style={{ fontSize: '0.8rem', color: 'var(--error-text)', margin: '0 0 0.75rem' }}>
          Could not load <code>GET /api/guides/credits</code>. Open <Link to="/guides">Guides</Link> or call the API
          directly.
        </p>
      )}
      {!guideLoading && !guideErr && guideMd && (
        <div style={mdBox}>
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1
                  style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.75rem' }}
                >
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2
                  style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: '1rem 0 0.5rem' }}
                >
                  {children}
                </h2>
              ),
              p: ({ children }) => <p style={{ margin: '0 0 0.6rem' }}>{children}</p>,
              ol: ({ children }) => <ol style={{ margin: '0 0 0.6rem 1.1rem', padding: 0 }}>{children}</ol>,
              ul: ({ children }) => <ul style={{ margin: '0 0 0.6rem 1.1rem', padding: 0 }}>{children}</ul>,
              li: ({ children }) => <li style={{ marginBottom: '0.25rem' }}>{children}</li>,
              pre: ({ children }) => (
                <pre
                  style={{
                    margin: '0 0 0.6rem',
                    overflow: 'auto',
                    padding: '0.5rem',
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {children}
                </pre>
              ),
              code: ({ className, children }) => {
                const block = typeof className === 'string' && className.startsWith('language-');
                if (block) {
                  return (
                    <code
                      className={className}
                      style={{ fontSize: '0.78rem', display: 'block', whiteSpace: 'pre', fontFamily: 'monospace' }}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code
                    style={{
                      fontSize: '0.82rem',
                      background: 'var(--bg-primary)',
                      padding: '0.1rem 0.25rem',
                      borderRadius: '4px',
                    }}
                  >
                    {children}
                  </code>
                );
              },
              a: ({ href, children }) => (
                <a href={href} style={{ color: 'var(--focus-border)' }} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {guideMd}
          </ReactMarkdown>
        </div>
      )}

      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
        This deployment (from <code style={{ fontSize: '0.7rem' }}>GET /api/agents/deposit-address</code>)
      </div>
      <CopyRow label={`USDC contract (${deposit.chain})`} value={deposit.usdcContract} />
      <CopyRow label="Treasury address" value={deposit.address} />
    </div>
  );
}
