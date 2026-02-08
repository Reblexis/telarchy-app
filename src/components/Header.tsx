import type { GraphInterval } from '../types';
import { useDarkMode } from '../hooks/useDarkMode';
import { getCookie, setCookie } from '../lib/cookies';

interface HeaderProps {
  onLogout: () => void;
  onReconfigure: () => void;
  graphInterval: GraphInterval;
  onIntervalChange: (interval: GraphInterval) => void;
}

export function Header({ onLogout, onReconfigure, graphInterval, onIntervalChange }: HeaderProps) {
  const { isDark, toggle } = useDarkMode();

  return (
    <div className="header">
      <h1>Metrics Tracker</h1>
      <div className="header-actions">
        <select
          id="graphInterval"
          title="Graph time interval"
          value={graphInterval}
          onChange={(e) => onIntervalChange(e.target.value as GraphInterval)}
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>
        <button className="dark-mode-toggle" onClick={toggle} title="Toggle dark mode">
          {isDark ? '☀️' : '🌙'}
        </button>
        <button className="reconfigure-btn" onClick={onReconfigure}>
          ⚙️ Reconfigure Firebase
        </button>
        <button className="logout-btn" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}
