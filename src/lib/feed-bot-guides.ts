/** The bot guide a feed kind publishes, linked on the new-bot form its
 * market's door opens (docs/audience-pages.md, "The door from a market"). */
export const FEED_BOT_GUIDES: Record<string, { label: string; url: string }> = {
  chess: {
    label: 'How to trade chess with a bot: the game feed, a dry run, a reference bot',
    url: 'https://github.com/Reblexis/telarchy-chess/blob/main/docs/trading.md',
  },
};
