"""Exceptions that mirror the API's error codes.

The API returns a sentence in ``error`` whose wording is explicitly not stable,
and, on the errors a participant acts on, a stable ``code`` beside it. This maps
those codes to types, so calling code branches on a class rather than on a
string that any copy edit can change.

An error the API has not given a code to raises the base :class:`TelarchyError`.
That is deliberate and matches the API's own rule: an absent code means "not
coded yet", never "cannot happen", so new codes appear over time and old ones
never change meaning.
"""

from __future__ import annotations

from typing import Any


class TelarchyError(Exception):
    """Any error answer from the API.

    ``message`` is the API's sentence, for a human. ``code`` is the stable name
    where there is one. ``body`` is the whole response, because several errors
    carry numbers worth reading: ``balance`` and ``cost`` on an insufficient
    balance, ``available`` on an oversized sell, ``requiredCapabilities`` on a
    permission failure.
    """

    def __init__(self, message: str, *, status: int, code: str | None = None, body: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.body: dict[str, Any] = body or {}
        self.doc_url: str | None = self.body.get("doc_url")


class InsufficientBalance(TelarchyError):
    """You cannot afford it. ``balance`` and ``cost`` say by how much."""

    @property
    def balance(self) -> float:
        return float(self.body.get("balance", 0))

    @property
    def cost(self) -> float:
        return float(self.body.get("cost", 0))


class InsufficientShares(TelarchyError):
    """Selling more than the position holds. ``available`` is what there is."""

    @property
    def available(self) -> float:
        return float(self.body.get("available", 0))


class TradeTooSmall(TelarchyError):
    """The budget cannot buy a share against this curve."""


class MarketNotFound(TelarchyError):
    """No such market in this workspace. Market ids are per workspace."""


class MarketResolved(TelarchyError):
    """Settled. Nothing trades again, in either direction. Never retry."""


class MarketVoided(TelarchyError):
    """Cancelled and refunded. Never retry."""


class MarketClosed(TelarchyError):
    """Sell-only. A buy will never succeed here; a sell of a position will."""


class IdempotencyKeyReuse(TelarchyError):
    """That key was used for a DIFFERENT body. Use a new one, or resend the original."""


class IdentityRequired(TelarchyError):
    """The call needs a participant and you are anonymous. Register, or send a key."""


class NotAuthorized(TelarchyError):
    """Your identity is fine; its permission groups lack the capability.

    Registering again does not fix this. ``required_capabilities`` says what a
    workspace admin would have to grant.
    """

    @property
    def required_capabilities(self) -> list[str]:
        return list(self.body.get("requiredCapabilities", []))


#: Code to class. Anything absent raises the base TelarchyError.
BY_CODE: dict[str, type[TelarchyError]] = {
    "insufficient_balance": InsufficientBalance,
    "insufficient_shares": InsufficientShares,
    "trade_too_small": TradeTooSmall,
    "market_not_found": MarketNotFound,
    "market_resolved": MarketResolved,
    "market_voided": MarketVoided,
    "market_closed": MarketClosed,
    "idempotency_key_reuse": IdempotencyKeyReuse,
    "identity_required": IdentityRequired,
    "not_authorized": NotAuthorized,
}


def from_response(status: int, body: dict[str, Any]) -> TelarchyError:
    """Build the most specific exception the response supports."""
    code = body.get("code")
    cls = BY_CODE.get(code, TelarchyError) if isinstance(code, str) else TelarchyError
    message = str(body.get("error") or f"HTTP {status}")
    return cls(message, status=status, code=code if isinstance(code, str) else None, body=body)
