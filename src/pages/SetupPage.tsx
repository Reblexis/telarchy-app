import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveFirebaseConfig } from '../lib/firebase';
import { useDarkMode } from '../hooks/useDarkMode';

export function SetupPage() {
  const navigate = useNavigate();
  const { isDark, toggle } = useDarkMode();
  const [configInput, setConfigInput] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);

    try {
      const config = JSON.parse(configInput.trim());
      saveFirebaseConfig(config);
      setMessage({ text: 'Configuration saved successfully! Redirecting...', type: 'success' });
      setTimeout(() => navigate('/login'), 1000);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setMessage({ text: 'Invalid JSON format. Please check your configuration and try again.', type: 'error' });
      } else {
        setMessage({ text: (error as Error).message, type: 'error' });
      }
      setSaving(false);
    }
  };

  return (
    <>
      <button className="dark-mode-toggle" onClick={toggle} title="Toggle dark mode" style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 1000 }}>
        {isDark ? '☀️' : '🌙'}
      </button>
      <div className="setup-page">
        <div className="container" style={{ maxWidth: 600 }}>
          <h1>Firebase Setup</h1>
          <p className="subtitle">Configure your Firebase project to get started with Metrarchy</p>

          <div className="steps">
            <h3>Before you begin:</h3>
            <ol>
              <li>Create a Firebase project at <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">console.firebase.google.com</a></li>
              <li>Enable Email/Password authentication</li>
              <li>Create a Firestore database</li>
              <li>Copy your Firebase config from Project Settings → General → Your apps</li>
            </ol>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="configInput">Paste your Firebase configuration:</label>
              <textarea
                id="configInput"
                value={configInput}
                onChange={e => setConfigInput(e.target.value)}
                placeholder={'Paste the firebaseConfig object here, e.g.:\n{\n  "apiKey": "YOUR_API_KEY",\n  "authDomain": "your-project.firebaseapp.com",\n  "projectId": "your-project-id"\n}'}
                required
                style={{ minHeight: 200, fontFamily: "'SF Mono', 'Monaco', 'Consolas', monospace", fontSize: '0.875rem' }}
              />
            </div>
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Configuration'}</button>
            {message && (
              <div className={`message show ${message.type}`}>{message.text}</div>
            )}
          </form>

          <div className="example">
            <h3>Example Configuration</h3>
            <pre>{`{
  "apiKey": "AIzaSyAbc123def456ghi789jkl012mno345pqr",
  "authDomain": "my-metrics-tracker.firebaseapp.com",
  "projectId": "my-metrics-tracker",
  "storageBucket": "my-metrics-tracker.appspot.com",
  "messagingSenderId": "123456789012",
  "appId": "1:123456789012:web:abc123def456"
}`}</pre>
            <p>Your actual values will be different. Find them in your Firebase Console under Project Settings.</p>
          </div>
        </div>
      </div>
    </>
  );
}
