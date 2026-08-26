import { useEffect, useState } from 'react';

/**
 * Light / dark toggle in the top-right of every top bar (owner ask
 * 2026-08-26). Spec: docs/ui-conventions.md, "The top bar and the account
 * menu".
 *
 * The stylesheet has long honoured `data-theme` on <html> next to the OS
 * preference; this is the control that sets it. The stored choice is applied
 * before first paint by the inline script in index.html, so this component
 * only has to read what is already there and flip it.
 */

const STORAGE_KEY = 'telarchy-theme';
type Theme = 'light' | 'dark';

function resolvedTheme(): Theme {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (typeof document === 'undefined' ? 'light' : resolvedTheme()));

  // Until the visitor has chosen, keep following the OS if it changes
  // underneath us (a scheduled dark mode at dusk, for instance).
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      if (!document.documentElement.getAttribute('data-theme')) setTheme(resolvedTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const flip = () => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the choice lasts the page, which is still a choice */
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="pubws-theme"
      onClick={flip}
      aria-label={next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {next === 'dark' ? (
        <svg
          className="pubws-theme-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
        </svg>
      ) : (
        <svg
          className="pubws-theme-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
        </svg>
      )}
      <span className="pubws-theme-label">{next === 'dark' ? 'Dark mode' : 'Light mode'}</span>
    </button>
  );
}
