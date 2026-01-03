const DARK_MODE_KEY = 'metricsTrackerDarkMode';

export function initDarkMode() {
  const savedMode = localStorage.getItem(DARK_MODE_KEY);
  if (savedMode === 'dark') {
    document.documentElement.classList.add('dark-mode');
  }
}

export function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark-mode');
  localStorage.setItem(DARK_MODE_KEY, isDark ? 'dark' : 'light');
}

export function isDarkMode() {
  return document.documentElement.classList.contains('dark-mode');
}

if (typeof window !== 'undefined') {
  initDarkMode();
}


