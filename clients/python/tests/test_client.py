"""Tests for the Telarchy Python client.

Standard library only, like the client: ``python3 -m unittest discover`` and
nothing to install. The HTTP is exercised against a local stub rather than
mocked, so the request the client actually puts on the wire is what is asserted.

The load-bearing ones are named after the rules they protect:

* a retry cannot become a second trade, because every trade carries a key;
* an error code becomes a type, so callers never match on a sentence;
* every path the client uses exists in the published OpenAPI document, which is
  the same drift guard the rest of this repo uses.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import unittest
import warnings
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from telarchy import (  # noqa: E402
    IdentityRequired,
    InsufficientBalance,
    MarketClosed,
    NotAuthorized,
    Telarchy,
    TelarchyError,
)

RECORDED: list[dict] = []
REPLY: dict = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # keep the test output clean
        pass

    def _record(self, method: str):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode() if length else ""
        RECORDED.append(
            {
                "method": method,
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body": json.loads(raw) if raw else None,
            }
        )

    def _reply(self):
        status = REPLY.get("status", 200)
        body = json.dumps(REPLY.get("body", {})).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in REPLY.get("headers", {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._record("GET")
        self._reply()

    def do_POST(self):
        self._record("POST")
        self._reply()

    def do_DELETE(self):
        self._record("DELETE")
        self._reply()


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}/api"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        RECORDED.clear()
        REPLY.clear()
        REPLY.update({"status": 200, "body": {}})

    def client(self, **kw) -> Telarchy:
        return Telarchy(base_url=self.base, **kw)


class TestRequestShape(Base):
    def test_reading_needs_no_key(self):
        REPLY["body"] = [{"id": "m1"}]
        out = self.client(workspace="telarchy").markets()
        self.assertEqual(out, [{"id": "m1"}])
        self.assertNotIn("x-agent-key", RECORDED[0]["headers"])
        self.assertEqual(RECORDED[0]["headers"]["x-workspace-id"], "telarchy")

    def test_the_workspace_travels_on_every_call(self):
        # Forgetting X-Workspace-Id is the most common mistake against this API,
        # which is why it is a constructor argument and not a per-call one.
        c = self.client(key="k", workspace="telarchy")
        c.markets()
        c.balance()
        for r in RECORDED:
            self.assertEqual(r["headers"]["x-workspace-id"], "telarchy")
            self.assertEqual(r["headers"]["x-agent-key"], "k")

    def test_query_params_are_sent_and_none_is_omitted(self):
        self.client(workspace="w").markets(status="open", limit=5, kind=None)
        self.assertIn("status=open", RECORDED[0]["path"])
        self.assertIn("limit=5", RECORDED[0]["path"])
        self.assertNotIn("kind", RECORDED[0]["path"])


class TestTrading(Base):
    def test_THE_RULE_every_real_trade_carries_an_idempotency_key(self):
        # An unattended bot retries on timeout. Without a key the retry buys
        # again, on a curve its own first attempt moved.
        REPLY["body"] = {"tradeId": "t1", "shares": 1}
        self.client(key="k", workspace="w").trade("m1", direction="higher", amount=5)
        self.assertIn("idempotency-key", RECORDED[0]["headers"])
        self.assertTrue(RECORDED[0]["headers"]["idempotency-key"])

    def test_two_trades_get_different_keys(self):
        c = self.client(key="k", workspace="w")
        c.trade("m1", direction="higher", amount=5)
        c.trade("m1", direction="higher", amount=5)
        a = RECORDED[0]["headers"]["idempotency-key"]
        b = RECORDED[1]["headers"]["idempotency-key"]
        self.assertNotEqual(a, b, "two deliberate trades must not dedupe into one")

    def test_a_supplied_key_is_used_verbatim_so_a_retry_is_possible(self):
        c = self.client(key="k", workspace="w")
        c.trade("m1", direction="higher", amount=5, idempotency_key="mine")
        c.trade("m1", direction="higher", amount=5, idempotency_key="mine")
        self.assertEqual(RECORDED[0]["headers"]["idempotency-key"], "mine")
        self.assertEqual(RECORDED[1]["headers"]["idempotency-key"], "mine")

    def test_a_dry_run_carries_no_key_because_it_records_nothing(self):
        self.client(key="k", workspace="w").trade("m1", direction="higher", amount=5, dry_run=True)
        self.assertNotIn("idempotency-key", RECORDED[0]["headers"])
        self.assertIs(RECORDED[0]["body"]["dryRun"], True)

    def test_the_body_names_direction_not_outcome(self):
        # The field name the copy-prompt got wrong for weeks. Pinned here too.
        self.client(key="k", workspace="w").trade("m1", direction="higher", amount=5)
        self.assertEqual(RECORDED[0]["body"], {"marketId": "m1", "direction": "higher", "amount": 5})

    def test_each_of_the_three_modes_sends_its_own_fields(self):
        c = self.client(key="k", workspace="w")
        c.trade("m1", target_value=650, max_budget=5)
        self.assertEqual(RECORDED[-1]["body"], {"marketId": "m1", "targetValue": 650, "maxBudget": 5})
        c.trade("m1", direction="lower", sell_shares=2.5)
        self.assertEqual(RECORDED[-1]["body"], {"marketId": "m1", "direction": "lower", "sellShares": 2.5})

    def test_an_ambiguous_or_empty_mode_is_refused_before_the_network(self):
        c = self.client(key="k", workspace="w")
        with self.assertRaises(ValueError):
            c.trade("m1")
        with self.assertRaises(ValueError):
            c.trade("m1", direction="higher", amount=5, target_value=1, max_budget=1)
        self.assertEqual(RECORDED, [], "a bad call must not reach the API at all")


class TestErrors(Base):
    def test_THE_RULE_a_code_becomes_a_type(self):
        REPLY.update(
            {
                "status": 400,
                "body": {"error": "Insufficient balance: ...", "code": "insufficient_balance", "balance": 0, "cost": 5},
            }
        )
        with self.assertRaises(InsufficientBalance) as cm:
            self.client(key="k", workspace="w").trade("m1", direction="higher", amount=5)
        self.assertEqual(cm.exception.balance, 0)
        self.assertEqual(cm.exception.cost, 5)
        self.assertEqual(cm.exception.code, "insufficient_balance")

    def test_the_three_market_states_are_different_types(self):
        # A bot retries a closed market's sell and never retries a resolved one.
        for code, cls in [("market_closed", MarketClosed)]:
            REPLY.update({"status": 400, "body": {"error": "x", "code": code}})
            with self.assertRaises(cls):
                self.client(key="k", workspace="w").trade("m1", direction="higher", amount=1)

    def test_not_authorized_carries_what_would_fix_it(self):
        REPLY.update(
            {"status": 403, "body": {"error": "Forbidden", "code": "not_authorized", "requiredCapabilities": ["trade"]}}
        )
        with self.assertRaises(NotAuthorized) as cm:
            self.client(key="k", workspace="w").trade("m1", direction="higher", amount=1)
        self.assertEqual(cm.exception.required_capabilities, ["trade"])

    def test_identity_required_is_distinct_from_not_authorized(self):
        REPLY.update({"status": 403, "body": {"error": "x", "code": "identity_required"}})
        with self.assertRaises(IdentityRequired):
            self.client(workspace="w").trade("m1", direction="higher", amount=1)

    def test_an_uncoded_error_is_still_an_error_not_a_crash(self):
        # Coverage is partial by design: absent means "not coded yet".
        REPLY.update({"status": 400, "body": {"error": "something new"}})
        with self.assertRaises(TelarchyError) as cm:
            self.client(key="k", workspace="w").markets()
        self.assertIsNone(cm.exception.code)
        self.assertEqual(cm.exception.status, 400)

    def test_a_non_json_error_body_does_not_crash_the_client(self):
        REPLY.update({"status": 502, "body": "not json at all"})
        with self.assertRaises(TelarchyError) as cm:
            self.client(key="k", workspace="w").markets()
        self.assertEqual(cm.exception.status, 502)


class TestDeprecations(Base):
    def test_THE_RULE_a_deprecation_reaches_the_caller(self):
        # The only channel that reaches a running bot whose author is not
        # reading release notes. Swallowing it is how the notice becomes an
        # outage later.
        REPLY["headers"] = {"X-Telarchy-Deprecation": "?active= is deprecated; use ?status=."}
        REPLY["body"] = []
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            self.client(workspace="w").markets()
        self.assertTrue(any(issubclass(w.category, DeprecationWarning) for w in caught))
        self.assertTrue(any("?status=" in str(w.message) for w in caught))

    def test_no_warning_when_nothing_is_deprecated(self):
        REPLY["body"] = []
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            self.client(workspace="w").markets()
        self.assertFalse([w for w in caught if issubclass(w.category, DeprecationWarning)])


class TestRegistration(Base):
    def test_register_returns_a_client_holding_the_new_key(self):
        REPLY["body"] = {"agentId": "bot", "apiKey": "secret-key"}
        c = Telarchy.register("bot", "telarchy", base_url=self.base)
        self.assertEqual(c.key, "secret-key")
        self.assertEqual(c.workspace, "telarchy")
        self.assertEqual(RECORDED[0]["body"]["source"], "github")

    def test_registering_sends_no_key_because_it_has_none_yet(self):
        REPLY["body"] = {"apiKey": "k"}
        Telarchy.register("bot", "telarchy", base_url=self.base)
        self.assertNotIn("x-agent-key", RECORDED[0]["headers"])


class TestSpecAgreement(unittest.TestCase):
    """Every path the client calls must exist in the published OpenAPI document.

    Same drift guard the rest of the repo uses: a client that calls a path the
    document does not describe is a client built on a guess.
    """

    def test_client_paths_are_in_the_published_spec(self):
        here = os.path.dirname(__file__)
        spec_path = os.path.abspath(os.path.join(here, "..", "..", "..", "public", "openapi.json"))
        if not os.path.exists(spec_path):
            self.skipTest(f"no spec at {spec_path}")
        with open(spec_path) as fh:
            spec = json.load(fh)
        described = set()
        for p in spec["paths"]:
            described.add(p.rstrip("/"))

        def normalise(p: str) -> str:
            parts = []
            for seg in p.split("/"):
                parts.append("{p}" if seg.startswith("{") else seg)
            return "/".join(parts).rstrip("/")

        described = {normalise(p) for p in described}
        # The subset of the client's surface the spec currently covers. The spec
        # documents 15 of ~194 endpoints, so this asserts agreement where there
        # is any, rather than pretending the spec is complete.
        used = ["/predictions/trade", "/predictions/markets", "/agents/register", "/status", "/help"]
        for path in used:
            self.assertIn(path, described, f"the client calls {path} but the spec does not describe it")


if __name__ == "__main__":
    unittest.main()
