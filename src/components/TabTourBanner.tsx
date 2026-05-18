import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTutorial, AUTO_TUTORIALS_ENABLED } from '../hooks/useTutorial';
import { TAB_TUTORIAL_META } from '../tutorials';
import type { TabTutorialId } from '../tutorials/types';

/**
 * Slim opt-in banner that fires the first time the user lands on a tab.
 * On accept, launches the matching tab tutorial. On dismiss, sets a
 * per-tab localStorage flag so the banner never re-appears.
 * Suppressed while a persona tutorial or persona-picker is active, so we
 * never stack overlays.
 */

const BANNER_KEY_PREFIX = 'telarchy.tutorial.tabBanner.';

export function TabTourBanner() {
  const { startTutorial, activeId, needsPersona } = useTutorial();
  const location = useLocation();
  const [tick, setTick] = useState(0);

  // Find the tab tutorial whose path matches the current route.
  const entry = Object.entries(TAB_TUTORIAL_META).find(([, meta]) => meta.path === location.pathname);
  const tabId = (entry?.[0] ?? null) as TabTutorialId | null;
  const meta = entry?.[1] ?? null;

  // Force a re-evaluation when localStorage may have changed.
  useEffect(() => { setTick(t => t + 1); }, [location.pathname]);

  if (!AUTO_TUTORIALS_ENABLED) return null;
  if (!tabId || !meta) return null;
  if (activeId || needsPersona) return null;
  if (typeof window === 'undefined') return null;
  if (window.localStorage.getItem(BANNER_KEY_PREFIX + tabId)) return null;
  // tick is read to satisfy lint; the state read is what re-runs this on
  // navigation, so the check above sees the latest localStorage value.
  void tick;

  const onTake = () => {
    window.localStorage.setItem(BANNER_KEY_PREFIX + tabId, '1');
    startTutorial(tabId);
  };

  const onDismiss = () => {
    window.localStorage.setItem(BANNER_KEY_PREFIX + tabId, '1');
    setTick(t => t + 1);
  };

  return (
    <div className="tab-tour-banner" role="region" aria-label="Tab tutorial available" data-tour-id={`tab-banner-${tabId}`}>
      <span className="tab-tour-banner-text">{meta.bannerCta}</span>
      <div className="tab-tour-banner-actions">
        <button type="button" className="tab-tour-banner-btn tab-tour-banner-btn-primary" onClick={onTake}>
          Take tour
        </button>
        <button type="button" className="tab-tour-banner-btn tab-tour-banner-btn-ghost" onClick={onDismiss}>
          No thanks
        </button>
      </div>
    </div>
  );
}
