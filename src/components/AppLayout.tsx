import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Logo } from './Logo';
import { FeedbackModal } from './FeedbackModal';
import { WelcomeTour } from './WelcomeTour';
import { WelcomeTourProvider } from '../hooks/useWelcomeTour';
import { useAuth } from '../hooks/useAuth';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

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
    <WelcomeTourProvider>
    <div className="app-layout">
      <header className="mobile-topbar">
        <Logo variant="mark" height="1.75rem" className="mobile-topbar-logo" />
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
      {user && (
        <button
          type="button"
          className="feedback-fab"
          aria-label="Report bug or get help"
          title="Report bug or get help"
          onClick={() => setFeedbackOpen(true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="feedback-fab-label">Help</span>
        </button>
      )}
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      {user && <WelcomeTour />}
    </div>
    </WelcomeTourProvider>
  );
}
