# Persona findings: Dev, the invited collaborator

Date: 2026-04-20. Executor: Claude. Budget: 5 min. Used: ~5 min.

Two-account flow. Inviter: Priya QA (persona 11 session, created `Persona11 Test Co`, workspace id `6d0d7083-1663-4798-ad05-c36d869c8853`, public/Open visibility). Invitee: fresh account `qa12-<ts>@example.test` (Dev QA). Both sessions on production telarchy.com.

## Outcome

Bounce with confusion. The naive "share the workspace URL" path (`telarchy.com/marketplace/<workspaceId>`) renders a blank page. Dev has to pivot to `/signup` → `/create-workspace` funnel → `/marketplace` → find workspace by name → click Join. That works, but Dev has no idea what permissions they got, sees `Edit` / `Delete` buttons on metrics they cannot actually use, sees the sidebar tab "Tasks" as empty even though a task exists in the workspace, and has several console 403s dropped on the devtools for endpoints their role can't access.

## Session log

1. T+00:00 — Paste `telarchy.com/marketplace/6d0d7083-…` (the URL pattern persona 12 expects a founder to send). Blank white page. Console warning: *"No routes matched location '/marketplace/6d0d7083-…'"*. First impression: broken.
2. T+00:30 — Before logout, the blank page actually shows **`"Inspecting: Hire senior designer full-time ($120k/yr) — showing impact predictions / Back to Tasks / Exit Inspect"`** leaked from the previous logged-in user's localStorage (`inspectTask` key survives logout). So the blank page can flash with another user's task title depending on storage state.
3. T+01:00 — Pivot to `/signup`. Fill in email / display name / password, accept consent, submit. Lands on `/create-workspace` asking "What do you want to improve? My startup / My life / scratch". Dev doesn't want a workspace, they want to *join* one. No visible "join a workspace" affordance on this page.
4. T+01:30 — Dev ignores the create flow, navigates to `/marketplace` via sidebar. 45+ market cards. Scrolls the list hunting for "Persona11 Test Co". Found it on market row #9.
5. T+02:00 — Click `Join workspace` on one of Persona11's market cards. Button immediately changes to `Trade` (no toast, no "you joined <workspace> as <role>"). Open console: 1 error 403 on `/api/agents/me` fired before the join completed. Not shown in UI but an attentive user would notice.
6. T+02:30 — `GET /api/auth/me` confirms membership: `{ workspaceId, memberRole: "trader", authRole: "agent" }`. Role granted is correct ("Open" visibility → trader on join), but the term `authRole: "agent"` is surprising for a human who signed up via the human form. (Platform uses "agent" = "participant", but a new user reads it as "AI".)
7. T+03:00 — Navigate to `/metrics`. Dashboard renders three metrics with `Now` and `Outlook` values (same view as the admin). Each metric row has buttons: `Zoom / Graph / Edit / Delete`. Clicking `Delete` hits `DELETE /api/metrics/:id` → 403. The backend is correct; the UI is not (buttons should be hidden / disabled for non-admins).
8. T+03:30 — Navigate to `/tasks`. Page shows "No tasks yet." `GET /api/tasks` (with workspace header) returns `[]`. But the workspace *does* have a task ("Hire senior designer full-time", status=approved). Either the endpoint filters to current-user-only, or to pending-only. For an invitee trying to "see what my boss set up", this is a dead page that hides the thing they came for.
9. T+04:00 — Navigate to `/check-in`. Page renders a "Update any metric" form for the three metrics. Dev can type new values and click `Save`. Need to verify if `POST /api/updates` accepts trader-submitted values — the page polls it and gets 403 twice on load, implying it may be admin-only for some operations. The form renders regardless. A trader who doesn't know their role will assume they can update company metrics.
10. T+04:30 — Sidebar: the "Settings" link is correctly hidden (admin only). `Check-in`, `Metrics`, `Markets`, `Tasks`, `Agents`, `Sources` are all visible. No badge or copy identifies Dev as a "Trader" vs "Admin". No "you have read/trade permissions" banner.
11. T+05:00 — Dev closes the tab. Mental model: "I think I joined something? It rendered but I can't tell what I'm allowed to touch, and the tasks tab is empty even though my boss told me they set one up."

## Friction found

- [blocker] F1 — **`/marketplace/<workspaceId>` does not route anywhere.** React Router logs "No routes matched location" and renders an empty `<div id="root">`. A founder sharing a direct workspace URL sends their invitee to a blank page. Fix: either add a `/marketplace/:workspaceId` route that renders a public workspace preview + join CTA, or change the marketplace to expose stable permalinks and remove the misleading pattern from docs/personas entirely.
- [blocker] F2 — **`inspectTask` in localStorage persists across logout.** Anonymous or freshly-logged-in users see a banner "Inspecting: <prior task title> - showing impact predictions" leaked from the previous session's state. Cross-user task-title leak on a shared machine. Fix: clear app-local storage on logout; or key the inspect state by `authUserId`.
- [blocker] F3 — **Post-signup routes to `/create-workspace`, not `/start`.** An invitee has no "join instead of create" path. Today they have to abandon create-workspace, go to `/marketplace`, find the workspace by name, and click Join. Fix the `postLoginPath` wiring so first-signup → `/start` (the fork page that offers "forecast on public markets").
- [blocker] F4 — **Tasks tab shows "No tasks yet." for a trader when an approved task exists in the workspace.** Either `/api/tasks` filters by proposer, by user-can-approve, or by pending status; whichever it is, a trader reading "what's going on here" sees a blank page. Fix: surface all tasks visible to a participant, with a "pending / approved / declined" filter; optionally show a "you cannot approve these" badge for traders.
- [blocker] F5 — **No role signalled anywhere in UI.** Dev has no visible indicator of being Trader. Persona 12's F3 high becomes blocker in practice because every screen (metrics with Edit/Delete, check-in with Save, tasks with Propose) looks *the same* to a trader as to an admin.
- [high] F6 — **Edit / Delete buttons render on metrics for traders** even though the backend returns 403. Clicking Delete on a team's KPI and hitting a silent 403 is a trust-scary experience. Hide or disable the admin-only controls client-side based on `memberRole`.
- [high] F7 — **Check-in form renders for traders** and appears submittable, though the underlying `POST /api/updates` route is admin-gated (evident from the two console 403s on page load). Either let traders submit or hide the form entirely.
- [high] F8 — **`/api/updates` returns 403 and the page keeps polling it**, producing repeated console errors for a role the client already knows doesn't have access. Gate the poll on `memberRole === 'admin'`.
- [high] F9 — **`authRole: "agent"` is returned for a human who signed up via the email form.** While AGENTS.md says participants are unified, the term confuses first-time human users. Consider renaming the field (e.g. `participantKind`) or returning a `userType: 'human' | 'bot'` alongside.
- [high] F10 — **No "you joined <Workspace> as Trader" toast after clicking Join workspace.** The button flips from `Join workspace` → `Trade` with zero narration. An Open workspace grants trade capability per vision, but Dev doesn't know that.
- [medium] F11 — **No workspace-scoped join link.** The only way Dev can discover Persona11 Test Co is to scan 45 mixed-workspace market cards on `/marketplace`. Invitees cannot be told "click this link and join" — they're told "sign up, then find us on the list". Add a `/w/<id>` or `/marketplace?workspace=<id>` filter that highlights a specific workspace card and renders a join CTA above the fold.
- [medium] F12 — **No visible join flow from `/marketplace` on large workspaces.** Clicking Join only fires on the card of the first matching market (the join succeeds, but the UX reads as "join this market" not "join this workspace"). Make the workspace-name heading into a workspace-scoped link/card with a single Join button.
- [medium] F13 — **Invitee sees `Propose Task` form on `/tasks`.** A trader can probably propose a task (at a credit cost), but the form lacks cost/consequence copy. If traders *cannot* propose, the form shouldn't render.
- [low] F14 — **`GET /api/workspaces/mine` returns 404.** Dev's dashboard would benefit from a "workspaces I'm in" endpoint; today the UI probably uses `authMe.workspaces` instead. Not a blocker but a missing API.

## What worked

- `Join workspace` button on a marketplace card succeeds in one click for Open workspaces; role granted is `trader` as intended.
- Sidebar hides `Settings` for non-admins.
- Backend enforces all admin-only actions (metric delete, workspace updates) with 403s. The gap is UI, not auth.
- The join is idempotent; clicking Join twice on the same workspace doesn't error.

## Would they come back?

Low probability. Persona 12's trust-neutral baseline means the first five minutes decide. Today: blank page on direct link, signup funnels into wrong flow, unclear role, empty tasks view. Dev closes the tab and tells their boss "seemed broken, maybe try again later".

## Recommended changes (ordered)

1. **Add a `/marketplace/:workspaceId` (or `/w/:id`) route.** Render workspace name, metric list, a "Join workspace" CTA, and a clear role preview ("Anyone can forecast — you'll get Trader access on join"). This is the single biggest fix for the invitee flow.
2. **Clear `inspectTask` (and any other user-scoped) localStorage on logout.**
3. **Wire `postLoginPath` so fresh signup → `/start`.** Re-verify the build picks up `src/lib/postLoginPath.ts` on OAuth and email signup paths; today it falls through to `/create-workspace`.
4. **Client-side `memberRole` gating** across metrics (Edit/Delete), check-in (Save), tasks (Propose), updates (panel). Hide admin-only affordances.
5. **Show role + permissions banner once on first render of a joined workspace**: *"You're a Trader in Persona11 Test Co. You can forecast on any market but can't change metrics or approve tasks."*
6. **Loosen the Tasks view**: show approved/declined tasks with a filter, not an empty page. This is what "see what the team decided" looks like.
7. **Stop polling `/api/updates` for non-admins** (client or server side gate).

## Console / network anomalies

- 6 console errors total during a 5-minute session on a fresh trader account:
  - 2× `GET /api/updates` → 403 (polling on metrics / check-in)
  - 1× `GET /api/agents/me` → 403 (fired before join completes)
  - 1× `DELETE /api/metrics/<id>` → 403 (test; a real user wouldn't hit this)
- `GET /api/auth/me` returns `email: null` for a user who signed up with a real email address. Unexpected; worth a separate investigation.
- React Router warning on `/marketplace/<uuid>` is noisy and persistent.
