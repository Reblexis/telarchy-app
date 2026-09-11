/**
 * The mark a bot's name carries on every public surface (docs/ui-conventions.md,
 * "A bot says it is one"): one small muted word, the same everywhere. A
 * participant with no browser account is a bot; the API says so beside the
 * name (`bot`, `fromBot`, `proposedByBot`), so this never guesses.
 */
export function BotMark({ bot }: { bot?: boolean | null }) {
  if (!bot) return null;
  return (
    <span className="pubws-bot" title="A bot: this participant trades through the API">
      bot
    </span>
  );
}
