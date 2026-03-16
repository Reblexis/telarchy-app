import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Page = 'metrics' | 'agents' | 'markets' | 'tasks';

const NAV_ITEMS: { to: string; label: string; page: Page }[] = [
  { to: '/metrics', label: 'Metrics', page: 'metrics' },
  { to: '/agents', label: 'Agents', page: 'agents' },
  { to: '/markets', label: 'Markets', page: 'markets' },
  { to: '/tasks', label: 'Tasks', page: 'tasks' },
];

interface HeaderProps {
  activePage: Page;
  actions?: ReactNode;
}

export function Header({ activePage, actions }: HeaderProps) {
  return (
    <div className="header">
      <img src="/logo.png" alt="Telarchy" style={{ height: '5.25rem' }} />
      <nav className="header-nav">
        {NAV_ITEMS.map(item => (
          <Link key={item.page} to={item.to} className={`nav-link${item.page === activePage ? ' active' : ''}`}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        {actions}
      </div>
    </div>
  );
}
