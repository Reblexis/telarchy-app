import { useState } from 'react';
import { type BuilderOptions, builderPrompt, type Connection } from '../lib/agent-builder';
import { withBase } from '../lib/base-path';
import { AgentManualSetup } from './AgentManualSetup';

export type CreatedConnection = { options: BuilderOptions; connection: Connection; userId: string };

/** Runtime instructions live beside their connection. Secrets stay in memory only. */
export function AgentConnectionSetup({
  options,
  apiKey,
  agentId,
}: {
  options: BuilderOptions;
  apiKey?: string;
  agentId: string;
}) {
  const [manual, setManual] = useState(false);
  const [copied, setCopied] = useState('');
  const [failed, setFailed] = useState(false);
  const prompt = builderPrompt(`${window.location.origin}${withBase('')}`, options, agentId);
  const copy = async (value: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <section className="builder-run" aria-label="Run this connection">
      {apiKey && (
        <div className="builder-secret">
          <span className="builder-secret-label">YOUR API KEY</span>
          <code className="builder-key">{apiKey}</code>
          <button type="button" className="doors-pill" onClick={() => void copy(apiKey, 'key')}>
            {copied === 'key' ? 'Key copied' : 'Copy key'}
          </button>
          <small>Save it now. It’s only shown this session.</small>
        </div>
      )}
      <div className="agent-manage-actions">
        <button type="button" onClick={() => void copy(prompt, 'prompt')}>
          {copied === 'prompt' ? 'Prompt copied' : 'Copy setup prompt'}
        </button>
        <button type="button" aria-expanded={manual} onClick={() => setManual(v => !v)}>
          {manual ? 'Hide manual setup' : 'Set up manually'}
        </button>
      </div>
      {copied === 'prompt' && <p role="status">Paste into your coding assistant to set up this connection.</p>}
      {failed && <p role="alert">Copy failed. Select the text and copy it manually.</p>}
      <details open={failed || undefined}>
        <summary>Read setup prompt</summary>
        <textarea aria-label="Setup prompt" readOnly value={prompt} rows={8} />
      </details>
      {manual && (
        <AgentManualSetup
          workspace={options.workspace}
          identity={options.identity}
          access={options.access}
          connected
          connectionForm={
            apiKey ? (
              <button type="button" onClick={() => void copy(apiKey, 'key')}>
                Copy key
              </button>
            ) : (
              <p>Use your saved key, or create one in Keys &amp; access.</p>
            )
          }
        />
      )}
    </section>
  );
}
