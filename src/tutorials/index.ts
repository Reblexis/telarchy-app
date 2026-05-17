import { builderTutorial } from './builder';
import { traderTutorial } from './trader';
import { agentTutorial } from './agent';
import type { Tutorial, TutorialId } from './types';

export const TUTORIALS: Record<TutorialId, Tutorial> = {
  builder: builderTutorial,
  trader: traderTutorial,
  agent: agentTutorial,
};

export function getTutorial(id: TutorialId): Tutorial {
  return TUTORIALS[id];
}

export type { Tutorial, TutorialId, TutorialStep, Persona, TutorialContext } from './types';
