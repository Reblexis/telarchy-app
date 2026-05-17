import { useTutorial } from '../hooks/useTutorial';
import { TUTORIALS, PERSONA_TUTORIALS, TAB_TUTORIALS } from '../tutorials';
import type { TutorialId } from '../tutorials/types';

interface Props {
  /** Compact mode: only show persona tracks, with a "see all" link. */
  compact?: boolean;
}

export function TutorialsLauncher({ compact = false }: Props) {
  const { activeId, stepIndex, completed, startTutorial } = useTutorial();

  const status = (id: TutorialId): { label: string; cta: string } => {
    if (activeId === id) {
      const total = TUTORIALS[id]?.steps.length ?? 0;
      return { label: `In progress, step ${stepIndex + 1}/${total}`, cta: 'Resume' };
    }
    if (completed.includes(id)) return { label: 'Completed', cta: 'Replay' };
    return { label: 'Not started', cta: 'Take tutorial' };
  };

  const personaList = Object.values(PERSONA_TUTORIALS);
  const tabList = Object.values(TAB_TUTORIALS);

  const renderCard = (t: typeof personaList[number]) => {
    const s = status(t.id);
    return (
      <li key={t.id} className="tutorial-card" data-tour-id={`tutorial-card-${t.id}`}>
        <div className="tutorial-card-body">
          <div className="tutorial-card-title">{t.title}</div>
          <div className="tutorial-card-blurb">{t.blurb}</div>
          <div className="tutorial-card-status">{s.label}</div>
        </div>
        <div className="tutorial-card-actions">
          <button type="button" className="tour-btn tour-btn-primary" onClick={() => startTutorial(t.id)}>
            {s.cta}
          </button>
        </div>
      </li>
    );
  };

  if (compact) {
    return (
      <section className="tutorials-launcher tutorials-launcher-compact" data-tour-id="tutorials-launcher">
        <header className="tutorials-launcher-header">
          <h2 className="tutorials-launcher-title">Interactive tutorials</h2>
          <p className="tutorials-launcher-subtitle">
            Action-driven walkthroughs that pause for you to actually do each step.
          </p>
        </header>
        <ul className="tutorials-list">
          {personaList.map(renderCard)}
        </ul>
      </section>
    );
  }

  return (
    <section className="tutorials-launcher" data-tour-id="tutorials-launcher">
      <header className="tutorials-launcher-header">
        <h2 className="tutorials-launcher-title">Persona tracks</h2>
        <p className="tutorials-launcher-subtitle">
          Pick the track that matches what you came here to do.
        </p>
      </header>
      <ul className="tutorials-list">
        {personaList.map(renderCard)}
      </ul>

      <header className="tutorials-launcher-header" style={{ marginTop: '2rem' }}>
        <h2 className="tutorials-launcher-title">Tab deep-dives</h2>
        <p className="tutorials-launcher-subtitle">
          Tab-specific short tours, also offered as opt-in banners on first visit.
        </p>
      </header>
      <ul className="tutorials-list">
        {tabList.map(renderCard)}
      </ul>
    </section>
  );
}
