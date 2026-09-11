import { BotGlyph } from './BotGlyph';

/**
 * The mark a bot's name carries on every public surface (docs/ui-conventions.md,
 * "A bot says it is one"): the bot icon, the same robot the Agents link draws,
 * with the accessible name "bot". A participant with no browser account is a
 * bot; the API says so beside the name (`bot`, `fromBot`, `proposedByBot`), so
 * this never guesses.
 */
export function BotMark({ bot }: { bot?: boolean | null }) {
  if (!bot) return null;
  return (
    <span className="pubws-bot" role="img" aria-label="bot" title="bot">
      <BotGlyph size="1em" strokeWidth={1.8} />
    </span>
  );
}
