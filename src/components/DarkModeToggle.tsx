import { useDarkMode } from '../hooks/useDarkMode';

export function DarkModeToggle({ fixed }: { fixed?: boolean }) {
  const { isDark, toggle } = useDarkMode();
  return (
    <button
      className="dark-mode-toggle"
      onClick={toggle}
      title="Toggle dark mode"
      style={fixed ? { position: 'fixed', top: '1rem', right: '1rem', zIndex: 1000 } : undefined}
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
