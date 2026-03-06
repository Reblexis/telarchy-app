import { useState, useEffect } from 'react';

const DARK_MODE_KEY = 'metrarchyDarkMode';

export function useDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem(DARK_MODE_KEY) === 'dark';
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
    localStorage.setItem(DARK_MODE_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggle = () => setIsDark(prev => !prev);

  return { isDark, toggle };
}
