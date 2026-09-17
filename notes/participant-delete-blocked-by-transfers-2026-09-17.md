# A participant with a credit transfer cannot be deleted (2026-09-17, open)

Found while trying to delete the test bot `manual-setup-test-0917` (Viktor
then said: "its fine keep it then", so the bot stays and nothing was changed).

`DELETE /api/agents/:id` answers 500 "Internal error" for any participant that
has ever sent or received a credit transfer. The route clears the participant's
trades, positions, deposits, withdrawals and keys, then deletes the agents row;
`credit_transfers.from_agent` / `to_agent` reference `agents.id` without a
cascade and the route never touches them, so the database refuses and the whole
transaction rolls back (nothing is half deleted). The test bot had received one
5 credit transfer. Not checked: whether funding at creation (`initialCredits`)
writes a transfer row too, in which case every funded bot is undeletable.

Two smaller findings on the same route: the failure logs nothing useful (the
500 had no error line in Cloud Run), and the admin session is refused with
"Only this participant, or whoever created it, can delete it" while the bot's
own key is refused for lacking `manage`, so a self-registered bot can be
deleted by the master key only.

The fix is a ledger rule, so it waits for a ruling. Options put to Viktor:

- A (recommended): keep the transfer rows and show the deleted side as a
  deleted participant, so the sender's history and balance stay true. Open
  sub-question: whether credits left on the deleted bot return to whoever
  funded it or vanish.
- B: refuse the delete with a clear message while transfers exist.
- C: delete the transfer rows with the bot, which rewrites the counterparty's
  history.
