import { useTutorial } from '../hooks/useTutorial';
import { TUTORIALS } from '../tutorials';
import type { TutorialId } from '../tutorials/types';

export function TutorialsPage() {
  const { activeId, stepIndex, completed, startTutorial, persona } = useTutorial();

  const status = (id: TutorialId): { label: string; cta: string } => {
    if (activeId === id) {
      return { label: `In progress, step ${stepIndex + 1}/${TUTORIALS[id].steps.length}`, cta: 'Resume' };
    }
    if (completed.includes(id)) return { label: 'Completed', cta: 'Replay' };
    return { label: 'Not started', cta: 'Take tutorial' };
  };

  return (
    <div className="page-content">
      <header className="page-header">
        <h1>Tutorials</h1>
        <p className="page-subtitle">
          Step-by-step walkthroughs that pause for you to actually do each step.
          {persona && <> Your saved persona: <strong>{persona}</strong>.</>}
        </p>
      </header>

      <ul className="tutorials-list">
        {Object.values(TUTORIALS).map(t => {
          const s = status(t.id);
          return (
            <li key={t.id} className="tutorial-card" data-tour-id={`tutorial-card-${t.id}`}>
              <div className="tutorial-card-body">
                <div className="tutorial-card-title">{t.title}</div>
                <div className="tutorial-card-blurb">{t.blurb}</div>
                <div className="tutorial-card-status">{s.label}</div>
              </div>
              <div className="tutorial-card-actions">
                <button
                  type="button"
                  className="tour-btn tour-btn-primary"
                  onClick={() => startTutorial(t.id)}
                >
                  {s.cta}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
