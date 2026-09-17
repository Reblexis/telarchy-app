# Limit order ticket comparison

Visual review artifact for Viktor's request, 2026-09-16.

[Open the HTML comparison](limit-order-ticket-before-after.html).

The comparison reconstructs the old ticket and proposes a revised layout using the supplied
LookPilot screenshot, the pre-fix ticket at `0f792161`, and the current branch.
It uses the existing dark theme tokens and 293px ticket width. It is a static
illustration with sample holdings, not a trading interface. The proposed order placement below the dialog is a design only. The app branch
still shows orders inside the ticket.

Acceptance checks, recorded before building:

1. An unfilled buy order is invisible in the old Sell ticket; the updated ticket
   shows Quick/Limit and the order with Cancel, without offering to sell it.
2. With both pending orders and owned shares, the updated ticket puts cancellable
   orders outside and below the trading dialog, with sellable shares inside. The old ticket omits the pending orders.
3. After a limit buy, the old ticket returns to Quick; the updated ticket keeps
   Buy, Limit, and the entered price. Do not imply every old action reset Buy/Sell.
4. All comparisons remain readable side by side on desktop and stacked on mobile,
   with no horizontal overflow. Controls are illustrative, clearly identified.
5. No network calls, live orders, or changes to the market are made by this page.

Visual sources: `src/style.css`, `src/components/TradeTicket.tsx`, and the user's
screenshot. Keep the warm ivory, dark surfaces, amber accents, serif display
heading, sans body text, and monospace amounts. Explanations sit outside the
reconstructed tickets so they cannot be mistaken for newly implemented UI.

Validation: inspected full-page browser screenshots at 1200px and 390px.
Both viewports have no horizontal overflow; all six tickets and three scenarios
are present. The page contains no forms, inputs, trading handlers, or external
resources. The Buy example preserves the native side-control ordering.

## Revised layout

Open limit orders stay visible below the trading dialog regardless of Buy/Sell
or Quick/Limit selection. Each order has Cancel only. Owned shares stay in the
Sell dialog. This comparison does not change the application.

Acceptance: each proposed example has an Open orders region immediately after
the ticket, never inside it; all three have Cancel and no Sell action in that
region. Existing tab selections and owned shares stay in the ticket.

Revised-layout validation: the structural test failed against all three old
examples before the HTML edit and passes afterwards. Browser checks at 390px
confirm each order region is outside and below its ticket, with no overflow.
Full-page desktop and mobile screenshots were inspected.

## Kalshi reference, 2026-09-17

Kalshi's current help documents separate buying/selling from order type:
quick orders trade at available prices; limit buys and limit sells specify a
price and quantity. Selling with a limit requires owned contracts. Its auto-sell
help places resting limit sells under Orders, where they can be edited or
cancelled before filling. Cancellation is management of an existing order,
not the counterpart of placing a new buy or sell.

Sources checked:
- [Limit purchase](https://help.kalshi.com/en/articles/13823813-limit-order-purchase)
- [Limit sale](https://help.kalshi.com/en/articles/13823815-limit-order-sale)
- [Quick orders](https://help.kalshi.com/en/articles/13823810-quick-orders)
- [Orders and cancellation](https://help.kalshi.com/en/articles/15521632-auto-sell-take-profit)

These sources establish behavior, not the exact current visual arrangement of
the authenticated trading ticket. No claim about pixel placement is verified.

Recommendation for Telarchy, not an implemented change: retain Buy/Sell in both
Quick and Limit modes. Name submit actions Buy now / Sell now for Quick and
Place buy order / Place sell order for Limit. Keep Open orders with Cancel
inside the dialog in either mode, following Viktor's latest layout preference.
Do not replace Sell with Cancel, since selling owned shares and cancelling an
unfilled instruction are different actions. The HTML currently still shows the
previous proposal with orders outside; it has not been revised for this research.

Follow-up: Kalshi's current event-order V2 API requires a price for every order
and supports immediate-or-cancel, fill-or-kill, and good-till-canceled lifetimes.
Thus immediate execution can use a marketable limit order; the UI distinction
Quick/Limit does not establish different underlying exchange order primitives.
The public Quick help calls it a market order, but does not document the exact
price or lifetime parameters sent by its frontend. Do not assert those parameters
without evidence. Source: https://docs.kalshi.com/api-reference/orders/create-order-v2
