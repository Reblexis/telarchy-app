import { Link } from 'react-router-dom';
import type { GraphInterval } from '../types';
import { useDarkMode } from '../hooks/useDarkMode';

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
      <img src="/logo.png" alt="Telarchy" style={{ height: '3.5rem' }} />
      <nav className="header-nav">
        <Link to="/metrics" className="nav-link active">Metrics</Link>
        <Link to="/agents" className="nav-link">Agents</Link>
        <Link to="/markets" className="nav-link">Markets</Link>
      </nav>
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
          ⚙️
        </button>
        <button className="logout-btn" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}
