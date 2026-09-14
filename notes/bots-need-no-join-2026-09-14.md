# Bots need no join: a bot is a new user on every public floor (2026-09-14)

**Owner decision 2026-09-14 (Viktor).** A bot built against the API was
refused trades on Snake (403, no trade permission) because the Agents page had
registered it for the telarchy workspace only, and the agent proposed calling
`POST /api/marketplace/snake/join`. Viktor:

> "there should not be any need to join ublic workspaces and there should nnot
> be any worskapce scoping as a matter of fact for the bots rn.. tey should
> have all workspace access taht the owner has.. always"

Asked whether that meant inheriting the owner's admin rights too (approve
proposals, write metric values, delete floors), he narrowed it:

> "just anything a newly signed up user could do.. so if for a given workspace
> they could propose then that too.. actually youre right the bot should be
> just like a new signed up user.. not think of it as inhertiing permissions
> just a new user everything is public rn anyway so we will worry about that
> later"

What the rule became, in `docs/guides/auth-and-keys.md` ("Which workspace a
call lands in"): a key in a workspace its participant is not a member of holds
the Public group's capabilities on a public floor, narrowed by its scopes, and
nothing on an unlisted or private one. Its first non-read request while holding
`trade` joins it to the Public group, so it shows on participant lists and the
leaderboard exactly as a browser user does after the page's silent join.
Nothing is inherited from the owner.

Side fix: both join routes appended to `member_ids` by reading the array and
writing it back, so two joins at once could erase one. They now share one
atomic UPDATE (`joinPublicGroup`). The in-process test database runs queries
one at a time, so that race cannot be made to fail in tests.
