# Transfers count in all-time profit too (2026-09-19)

**Ruling 2026-09-19 (Viktor):** "when credits aare sent via transfer credits
api or the send credits button it should count into profit/ negative profit".
Asked whether that reverses the 2026-09-17 sentence "a credit transfer is not
a trade, so the all-time board never counts one", and warned that anyone can
then lift a friend or a bot up the all-time board by sending it credits, he
answered "yes" and "support taht its fine".

What changed: the all-time board over every floor, the profile's stats, the
bots list on /agents and the daily profit snapshot add each account's net
peer transfers (received minus sent, all time, from `credit_transfers`) as
settled money. An account that only ever sent or received a transfer now has
a board row. The board scoped to one floor, and a floor's own footer, stay
trading alone, the same way the season's floor view does. The season score
is untouched (it has counted transfers since 2026-09-16, PR 343).

Consequences seen in the tests: an owner who funds a bot with 15,000 reads
-15,000 and the bot +15,000, and the profile's "with bots" total nets the
bankroll out. Profit snapshots written before this day hold the old number,
so a profile's profit history steps on 2026-09-19 for anyone who transferred.

Not changed: the send ticket still names only the season score as the cost
of a send. The marked-growth season baseline (unused since 2026-08-28) stays
trading alone.
