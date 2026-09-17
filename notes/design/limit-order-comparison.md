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
