import { builderTutorial } from './builder';
import { traderTutorial } from './trader';
import { agentTutorial } from './agent';
import { TAB_TUTORIALS, TAB_TUTORIAL_META } from './tabs';
import type { Tutorial, TutorialId, PersonaTutorialId } from './types';

export const PERSONA_TUTORIALS: Record<PersonaTutorialId, Tutorial> = {
  builder: builderTutorial,
  trader: traderTutorial,
  agent: agentTutorial,
};

export const TUTORIALS: Record<TutorialId, Tutorial> = {
  ...PERSONA_TUTORIALS,
  ...TAB_TUTORIALS,
} as Record<TutorialId, Tutorial>;

export function getTutorial(id: TutorialId): Tutorial {
  return TUTORIALS[id];
}

export { TAB_TUTORIALS, TAB_TUTORIAL_META };
export type { Tutorial, TutorialId, TutorialStep, Persona, TutorialContext, TabTutorialId, PersonaTutorialId } from './types';
