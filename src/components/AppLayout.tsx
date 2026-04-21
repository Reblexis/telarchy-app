import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  return (
    <div className="app-layout">
      <header className="mobile-topbar">
        <img src="/logo_transparent_bg.png" alt="Telarchy" className="mobile-topbar-logo" />
        <button
          className="mobile-topbar-btn"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(v => !v)}
        >
          <span className="mobile-topbar-burger"><span /></span>
        </button>
      </header>
      <Sidebar className={mobileOpen ? 'open' : ''} />
      <div
        className={`sidebar-scrim${mobileOpen ? ' show' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}
