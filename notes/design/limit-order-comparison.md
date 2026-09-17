# Limit order ticket comparison

[Open the HTML comparison](limit-order-ticket-before-after.html).

The accepted layout keeps Buy/Sell and Quick/Limit fixed. Open orders appear
inside the ticket in either mode under a visible label; each offers Cancel.
Owned shares remain sellable in Sell. Actions preserve the selected tab and mode.

The HTML is a static illustration of the implemented branch layout using sample
values. The old screenshots are reconstructed from the supplied screenshot and
pre-fix source. Secondary buy details are omitted. It cannot place trades.

Visual sources: the supplied Telarchy screenshot, src/style.css and TradeTicket.
Dark palette, 293px ticket width, native typography and direction colors remain.

Acceptance: orders appear inside all illustrated tickets and offer Cancel only.
The real component retains Buy/Sell in Quick and Limit, preserves selections
following actions, and never offers to sell an unfilled order.

Reference: Kalshi keeps Buy/Sell fixed while its dropdown selects Dollars,
Shares or Limit, as shown in Viktor's screenshot. Its exchange API requires a
price and supports different order lifetimes; that does not make cancellation
an alternative to selling owned shares.

Sources: [order API](https://docs.kalshi.com/api-reference/orders/create-order-v2),
[limit sales](https://help.kalshi.com/en/articles/13823815-limit-order-sale),
[order management](https://help.kalshi.com/en/articles/15521632-auto-sell-take-profit).

Validation: the new visible-label tests failed before the implementation and
pass afterwards; 132 focused frontend tests pass. The structural HTML test
failed for the external layout and passes for the internal layout. The actual
TradeTicket was exercised in a local browser harness with sample data: Sell
Limit keeps both selections after cancelling, removes the pending order, and
retains owned shares. At 390px the ticket has no horizontal overflow.
