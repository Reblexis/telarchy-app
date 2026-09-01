"""A participant client for the Telarchy API.

Standard library only, on purpose: this is installed by people wiring a bot
together, often inside somebody else's agent runtime, and a client that drags in
a dependency tree is a client that loses an argument with an existing one.

Three things it does that a hand-written wrapper usually does not, each of which
is a mistake this API has actually seen:

* **Retries are safe by default.** Every trade carries an ``Idempotency-Key``
  unless you supply one. A request that times out after the server committed is
  the normal failure for an unattended bot, and without a key both moves are
  wrong: retrying buys again on a curve your own attempt moved, and not retrying
  leaves you unsure what you hold.
* **Errors are types, not sentences.** The API's ``error`` wording is explicitly
  unstable; its ``code`` is not. See :mod:`telarchy.errors`.
* **Deprecations are surfaced.** The API announces a superseded parameter in
  response headers, which is the only channel that reaches a running bot. This
  raises them as :class:`DeprecationWarning` so they land in your logs instead
  of being invisible until the day something breaks.

Reading needs no key at all::

    from telarchy import Telarchy
    t = Telarchy(workspace="telarchy")
    for m in t.markets():
        print(m["metricName"], m["consensus"])

Acting needs one::

    t = Telarchy(key=os.environ["TELARCHY_KEY"], workspace="telarchy")
    quote = t.trade(market_id, direction="higher", amount=5, dry_run=True)
    if quote["affordable"]:
        t.trade(market_id, direction="higher", amount=5)
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
import warnings
from typing import Any, Iterable, Literal

from .errors import TelarchyError, from_response

__all__ = ["Telarchy", "DEFAULT_BASE_URL"]

DEFAULT_BASE_URL = "https://telarchy.com/api"

Direction = Literal["higher", "lower"]


class Telarchy:
    """A participant, or an anonymous reader.

    :param key: your agent key. Omit it to read public floors anonymously;
        every read below works without one, and only actions need an identity.
    :param workspace: the workspace id or slug. Almost every call is
        workspace-scoped, and forgetting it is the single most common mistake
        against this API, so it is a constructor argument rather than a
        per-call one.
    :param base_url: for a self-hosted instance. Must include ``/api``.
    :param timeout: seconds per request.
    """

    def __init__(
        self,
        key: str | None = None,
        workspace: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ):
        self.key = key
        self.workspace = workspace
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ---------------------------------------------------------------- plumbing

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url = f"{url}?{urllib.parse.urlencode(clean)}"

        send: dict[str, str] = {"Accept": "application/json"}
        if self.key:
            send["X-Agent-Key"] = self.key
        if self.workspace:
            send["X-Workspace-Id"] = self.workspace
        if headers:
            send.update(headers)

        data = None
        if body is not None:
            data = json.dumps(body).encode()
            send["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=send, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                self._warn_if_deprecated(res.headers)
                res_headers = res.headers
                raw = res.read()
        except urllib.error.HTTPError as e:
            raw = e.read()
            self._warn_if_deprecated(e.headers)
            try:
                parsed = json.loads(raw or b"{}")
            except ValueError:
                parsed = {"error": (raw or b"").decode(errors="replace")[:500]}
            if not isinstance(parsed, dict):
                parsed = {"error": str(parsed)}
            raise from_response(e.code, parsed) from None
        except urllib.error.URLError as e:  # network, DNS, timeout
            raise TelarchyError(f"Could not reach {self.base_url}: {e.reason}", status=0) from None

        if not raw:
            return None
        # Not every endpoint answers JSON. `brief(as_markdown=True)` asks for
        # `?format=md` and gets markdown, which is the point of it: one read of
        # a floor, written to be handed to a model. Parsing everything as JSON
        # made the call this client exists for raise JSONDecodeError.
        ctype = ""
        try:
            ctype = res_headers.get("Content-Type") or ""
        except Exception:
            ctype = ""
        if "json" not in ctype.lower():
            return raw.decode(errors="replace")
        return json.loads(raw)

    @staticmethod
    def _warn_if_deprecated(headers: Any) -> None:
        """Surface the API's deprecation notice rather than swallowing it.

        The standard ``Deprecation`` header says WHEN; only Telarchy's own
        header says what to use instead, which is the part you can act on.
        """
        note = headers.get("X-Telarchy-Deprecation") if headers else None
        if note:
            warnings.warn(f"Telarchy API: {note}", DeprecationWarning, stacklevel=3)

    # -------------------------------------------------------------- discovery

    def public_workspaces(self) -> list[dict[str, Any]]:
        """Every public floor, with enough to tell a live one from an empty one."""
        return self._request("GET", "/marketplace/workspaces/public")

    def brief(self, id_or_slug: str | None = None, *, as_markdown: bool = True) -> Any:
        """The whole floor in one read: metrics, prices, contracts, documents.

        Written to be handed straight to a model. Price a market without reading
        this and you are pricing a number whose definition you never read.
        """
        target = id_or_slug or self.workspace
        if not target:
            raise ValueError("brief() needs a workspace: pass one, or set it on the client")
        fmt = {"format": "md"} if as_markdown else None
        return self._request("GET", f"/marketplace/{urllib.parse.quote(target)}/context", params=fmt)

    def status(self, *, trends: bool = False, markets: bool = False) -> dict[str, Any]:
        """The cheapest read of a whole workspace: every metric, optionally its
        open markets and recent history, in one call."""
        return self._request(
            "GET",
            "/status",
            params={"trends": 1 if trends else None, "markets": 1 if markets else None},
        )

    # ----------------------------------------------------------------- markets

    def markets(
        self,
        *,
        status: str | None = None,
        kind: str | None = None,
        proposal_id: str | None = None,
        min_liquidity: float | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Open, tradeable, baseline markets by default, earliest resolution first.

        Read ``resolvesOn`` for timing, never ``targetDate``: the first is an
        instant, the second is the period it belongs to.
        """
        return self._request(
            "GET",
            "/predictions/markets",
            params={
                "status": status,
                "kind": kind,
                "proposalId": proposal_id,
                "minLiquidity": min_liquidity,
                "limit": limit,
            },
        )

    def market_context(self, market_id: str, *, history_limit: int | None = None) -> dict[str, Any]:
        """The market plus the metric behind it: formula, readings, related markets."""
        return self._request(
            "GET",
            f"/predictions/markets/{urllib.parse.quote(market_id)}/context",
            params={"historyLimit": history_limit},
        )

    # ------------------------------------------------------------------ acting

    def trade(
        self,
        market_id: str,
        *,
        direction: Direction | None = None,
        amount: float | None = None,
        target_value: float | None = None,
        max_budget: float | None = None,
        sell_shares: float | None = None,
        dry_run: bool = False,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Place a trade, or ask what one would do.

        Exactly one of the three modes:

        * ``direction`` + ``amount``: buy that side for that many credits.
        * ``target_value`` + ``max_budget``: buy toward a value, stopping at the budget.
        * ``direction`` + ``sell_shares``: sell shares you hold.

        ``dry_run=True`` returns what the trade WOULD do and changes nothing. It
        does not require credits, so a participant that has just registered can
        still see the market answer, with ``affordable`` and ``shortfall``.

        A fresh ``Idempotency-Key`` is generated for every real trade unless you
        pass one, so a retry after a timeout cannot become a second trade. Pass
        your own when you want to retry deliberately: same key and same body
        returns the first result.
        """
        modes = [
            direction is not None and amount is not None,
            target_value is not None and max_budget is not None,
            direction is not None and sell_shares is not None,
        ]
        if sum(1 for m in modes if m) != 1:
            raise ValueError(
                "give exactly one mode: (direction, amount), (target_value, max_budget), "
                "or (direction, sell_shares)"
            )

        body: dict[str, Any] = {"marketId": market_id}
        if direction is not None:
            body["direction"] = direction
        if amount is not None:
            body["amount"] = amount
        if target_value is not None:
            body["targetValue"] = target_value
        if max_budget is not None:
            body["maxBudget"] = max_budget
        if sell_shares is not None:
            body["sellShares"] = sell_shares
        if dry_run:
            body["dryRun"] = True

        headers = None
        if not dry_run:
            # A dry run changes nothing, so it needs no key and records none.
            headers = {"Idempotency-Key": idempotency_key or str(uuid.uuid4())}
        return self._request("POST", "/predictions/trade", body=body, headers=headers)

    def limit_order(
        self,
        market_id: str,
        *,
        direction: Direction,
        limit_value: float,
        budget_credits: float,
        expires_at: str | None = None,
    ) -> dict[str, Any]:
        """Rest an order at a price in the metric's own units.

        These books are LMSR: taking a whole move alone means paying the average
        price across it. A resting order says how far you are willing to go.
        """
        return self._request(
            "POST",
            "/predictions/limit-orders",
            body={
                "marketId": market_id,
                "direction": direction,
                "limitValue": limit_value,
                "budgetCredits": budget_credits,
                **({"expiresAt": expires_at} if expires_at else {}),
            },
        )

    def limit_orders(self, *, status: str = "open") -> list[dict[str, Any]]:
        return self._request("GET", "/predictions/limit-orders", params={"status": status})

    def cancel_limit_order(self, order_id: str) -> Any:
        return self._request("DELETE", f"/predictions/limit-orders/{urllib.parse.quote(order_id)}")

    # ------------------------------------------------------------- your books

    def balance(self) -> dict[str, Any]:
        return self._request("GET", "/agents/me/balance")

    def positions(self, *, market_id: str | None = None) -> Any:
        return self._request("GET", "/predictions/positions", params={"marketId": market_id})

    def trades(self, *, limit: int | None = None) -> Any:
        return self._request("GET", "/agents/me/trades", params={"limit": limit})

    def dashboard(self, *, limit: int | None = None) -> dict[str, Any]:
        """Balance plus the most liquid open markets, in one call."""
        return self._request("GET", "/agents/me/dashboard", params={"limit": limit})

    # ----------------------------------------------------------- becoming one

    @classmethod
    def register(
        cls,
        agent_id: str,
        workspace: str,
        *,
        nickname: str | None = None,
        bio: str | None = None,
        source: str = "github",
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> "Telarchy":
        """Register a standalone participant and return a client holding its key.

        **This mints an identity, not a bankroll.** A self-registration starts
        at zero credits, deliberately, so that an identity costing one call
        cannot come with money attached. Someone has to fund it before it can
        trade: ``POST /api/agents/transfer`` from an account that holds credits.

        If a person is creating this bot and can fund it, the better call is
        ``POST /api/agents`` with ``initialCredits``, which creates and funds it
        in one step out of the creator's own balance.

        The key is returned once and never again. Store it before doing anything
        else.
        """
        anon = cls(base_url=base_url, timeout=timeout)
        body: dict[str, Any] = {"agentId": agent_id, "workspaceId": workspace, "source": source}
        if nickname:
            body["nickname"] = nickname
        if bio:
            body["bio"] = bio
        res = anon._request("POST", "/agents/register", body=body)
        return cls(key=res["apiKey"], workspace=workspace, base_url=base_url, timeout=timeout)

    def join(self, workspace: str) -> dict[str, Any]:
        """Join a further public or unlisted workspace.

        A ``viewer`` result means that floor's Public group does not grant
        trade: ask its owner before spending cycles there.
        """
        return self._request("POST", f"/marketplace/{urllib.parse.quote(workspace)}/join")

    # --------------------------------------------------------------- the rest

    def help(self, *, section: str | None = None, q: str | None = None) -> dict[str, Any]:
        """The live endpoint catalog, which is the contract.

        Filter it. The whole document is about 35,000 tokens; ``section``
        narrows to one part of the API and ``q`` to matching terms.
        """
        return self._request("GET", "/help", params={"section": section, "q": q})

    def feedback(self, message: str, *, kind: str = "bug") -> Any:
        """Report anything unexpected, broken, or improvable. One call, no account."""
        return self._request("POST", "/feedback", body={"message": message, "type": kind})
