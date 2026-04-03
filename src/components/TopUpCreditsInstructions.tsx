import { useState } from 'react';

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
      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <code style={{ fontSize: '0.78rem', wordBreak: 'break-all', flex: 1, minWidth: 0 }}>{value}</code>
        <button
          type="button"
          onClick={copy}
          style={{
            flexShrink: 0,
            padding: '0.2rem 0.5rem',
            fontSize: '0.72rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.25rem',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * Explains USDC-on-Base → credits flow for Account and Agent portal.
 */
export function TopUpCreditsInstructions({
  deposit,
  creditValueUsd,
  guidesUrl,
}: {
  deposit: DepositAddressInfo | null;
  creditValueUsd: number | null | undefined;
  guidesUrl: string;
}) {
  if (!deposit) {
    return (
      <div
        style={{
          marginBottom: '1rem',
          padding: '0.75rem',
          background: 'var(--bg-secondary)',
          borderRadius: '0.375rem',
          border: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
        }}
      >
        Top-ups are not available on this deployment yet (no treasury address). Ask your administrator to configure on-chain settlement, or use another environment.
      </div>
    );
  }

  const rateLine =
    typeof creditValueUsd === 'number' && creditValueUsd > 0
      ? `On this server, about ${creditValueUsd} USDC buys roughly one credit before any buy fee.`
      : 'Credit pricing is set by this server; the exact USDC amount per credit appears after you submit a deposit or in the full guides.';

  return (
    <div
      style={{
        marginBottom: '1rem',
        padding: '0.85rem 1rem',
        background: 'var(--bg-secondary)',
        borderRadius: '0.375rem',
        border: '1px solid var(--border-color)',
      }}
    >
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
        How top-up works
      </div>
      <ol style={{ margin: '0 0 0.75rem 1.1rem', padding: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        <li style={{ marginBottom: '0.35rem' }}>
          In your wallet, switch to the <strong style={{ color: 'var(--text-primary)' }}>Base</strong> network and choose{' '}
          <strong style={{ color: 'var(--text-primary)' }}>USDC</strong> using the official contract below (wrong token or chain will not credit).
        </li>
        <li style={{ marginBottom: '0.35rem' }}>
          Send USDC to the <strong style={{ color: 'var(--text-primary)' }}>treasury address</strong> below (this is the only recipient that mints credits for this platform).
        </li>
        <li style={{ marginBottom: '0.35rem' }}>
          Wait until the transfer is <strong style={{ color: 'var(--text-primary)' }}>confirmed</strong> on Base.
        </li>
        <li>
          Paste the transaction hash (66-character <code style={{ fontSize: '0.78rem' }}>0x…</code>) into the field below and submit. Each hash can be used once; the server verifies the transfer and adds credits to <em>your</em> participant account.
        </li>
      </ol>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 0.75rem' }}>{rateLine}</p>
      <CopyRow label={`USDC contract (${deposit.chain})`} value={deposit.usdcContract} />
      <CopyRow label="Treasury address (send USDC here)" value={deposit.address} />
      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: 0 }}>
        More detail:{' '}
        <a href={guidesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--focus-border)' }}>
          Guides → Credits &amp; USDC
        </a>
        .
      </p>
    </div>
  );
}
