import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getConfigFromURL, saveFirebaseConfig } from './lib/firebase';
import './style.css';

// Process URL config parameter before React renders,
// so Firebase config is available when useAuth initializes.
const urlConfig = getConfigFromURL();
if (urlConfig) {
  try {
    saveFirebaseConfig(urlConfig);
  } catch (e) {
    console.error('Failed to save config from URL:', e);
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('config');
  window.history.replaceState({}, document.title, url.toString());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
