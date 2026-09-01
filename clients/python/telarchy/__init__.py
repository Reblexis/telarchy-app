"""Telarchy: a participant client for https://telarchy.com/api.

Standard library only. Reading a public floor needs no key at all.
"""

from .client import DEFAULT_BASE_URL, Telarchy
from .errors import (
    IdempotencyKeyReuse,
    IdentityRequired,
    InsufficientBalance,
    InsufficientShares,
    MarketClosed,
    MarketNotFound,
    MarketResolved,
    MarketVoided,
    NotAuthorized,
    TelarchyError,
    TradeTooSmall,
)

__version__ = "0.1.0"

__all__ = [
    "Telarchy",
    "DEFAULT_BASE_URL",
    "TelarchyError",
    "InsufficientBalance",
    "InsufficientShares",
    "TradeTooSmall",
    "MarketNotFound",
    "MarketResolved",
    "MarketVoided",
    "MarketClosed",
    "IdempotencyKeyReuse",
    "IdentityRequired",
    "NotAuthorized",
    "__version__",
]
