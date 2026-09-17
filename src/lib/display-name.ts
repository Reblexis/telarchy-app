/**
 * What a participant is called, everywhere (docs/agent-economy.md, "Optional
 * nickname"): the nickname, else the id when it is readable, else the last
 * resort ("anonymous"). One function so a board and a profile can never
 * disagree: before it, a bot created as "Anaconda" was Anaconda on its
 * profile and "anonymous" on every board.
 */
const readableId = (id: string) => (id.length <= 24 && /[a-z]/i.test(id) && id.includes('-')) || id.length <= 16;

export function displayName(
  nickname: string | null | undefined,
  id: string | null | undefined,
  lastResort = 'anonymous',
): string {
  if (nickname) return nickname;
  if (id && readableId(id)) return id;
  return lastResort;
}
