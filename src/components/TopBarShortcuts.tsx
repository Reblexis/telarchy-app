import { AgentNavLink } from './AgentNavLink';
import { DiscordButton } from './DiscordButton';
import { ReportButton } from './ReportButton';

/** The same shortcuts stay available on floors and standalone pages. */
export function TopBarShortcuts() {
  return (
    <>
      <DiscordButton />
      <ReportButton />
      <AgentNavLink />
    </>
  );
}
