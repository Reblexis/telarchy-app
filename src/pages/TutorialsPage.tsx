import { useTutorial } from '../hooks/useTutorial';
import { TutorialsLauncher } from '../components/TutorialsLauncher';

export function TutorialsPage() {
  const { persona } = useTutorial();
  return (
    <div className="page-content">
      <header className="page-header">
        <h1>Tutorials</h1>
        <p className="page-subtitle">
          Step-by-step walkthroughs that pause for you to actually do each step.
          {persona && <> Your saved persona: <strong>{persona}</strong>.</>}
        </p>
      </header>
      <TutorialsLauncher />
    </div>
  );
}
