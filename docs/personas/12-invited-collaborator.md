# Persona: Dev, the teammate invited into an existing workspace

Arrives via a link from a co-worker ("the founder is trying this out, take a look"). Desktop. Low prior curiosity, but obligated to check it out because a colleague asked.

## Context

- **Device**: desktop, 1280x800, Chrome. Zoom open, Slack open, calendar open.
- **Referral**: a founder or lead DM'd them the URL of a specific workspace (`telarchy.com/marketplace/<workspaceId>`) or a generic invite ("sign up and I'll add you").
- **Attention budget**: 5 minutes. Either this makes immediate sense in their existing team context or they close the tab and promise to "look later".
- **Trust level**: neutral. Not hostile, but won't read copy that doesn't match their immediate proposal.

## Background

Senior engineer at a startup where the founder/VP just signed up for Telarchy to track KPIs or evaluate some decision. Dev's goal: see what their boss set up, understand what's being asked of them, and leave with either a clear next step or a clean conscience.

## Mental model

**They already know**:
- What their team's main metrics are (even if they don't love them).
- What Notion / Linear / Figma look like when invited as a team member.
- That "workspaces" in a SaaS tool usually mean "separate teams / separate data".

**They don't know**:
- What Telarchy does or why their boss signed up for it.
- Whether they need to sign up to see what their team is doing.
- What a "prediction market" has to do with their job.
- Whether they're being asked to *look* or to *do something*.

## Success path

Clicks the link. Sees a recognizable workspace name and familiar metric names (e.g. "Monthly Revenue", "DAU"). Signs up (preferably via Google OAuth). Gets added to the workspace automatically or with one click. Sees the team's metrics and the current agent forecasts. Understands whether they're expected to trade / forecast themselves or just observe. Bookmarks URL.

## Session script

- **T+00:00 — Click the link.** Either a public workspace URL or a generic landing URL. If landing: is there a "join a workspace" CTA or do they have to search? If workspace URL: what's shown before login?
- **T+00:30 — Read what's on screen.** Is the workspace name visible? Are real metric names visible? Is there a read-only preview, or is everything gated behind signup?
- **T+01:00 — Sign up.** Prefers Google OAuth (team uses Google Workspace). Does the consent gate make sense in this context? Does the "1000 free credits" line confuse them (they're not here to trade, they're here to see what their boss set up)?
- **T+01:30 — Post-signup landing.** If they came from `/marketplace/<workspaceId>`, do they land back there, or get redirected elsewhere? If `/start`, is there a "join my team's workspace" option, or do they have to pick "create" vs "forecast"?
- **T+02:30 — Find the team workspace.** If they came from a direct link, the workspace is already known. Otherwise: how do they find the workspace their boss set up? Workspace ID? Workspace name search? Invite link?
- **T+03:00 — Join.** Click "Join workspace". What's the feedback? What role are they granted (read-only, trader, admin)? Is there a clear indicator of what they can and can't do?
- **T+03:30 — View the metrics.** Are metric values, forecasts, and recent updates visible to them? Can they see what agents are forecasting? Can they see if there are any active decisions / proposals?
- **T+04:30 — Understand their role.** "Am I supposed to do something here?" If there's no CTA, is it clear they're just observing?
- **T+05:00 — Close tab.** Decide: "this is useful, I'll come back" vs "this is my boss's project, I'll leave it alone".

## Friction triggers

- **Blocker**: clicking a direct workspace URL (`/marketplace/<workspaceId>`) leads to a 404 or a blank page for an anonymous user. Dev's first impression is "broken".
- **Blocker**: the only way to join a specific workspace is to know its opaque UUID. Dev cannot ask their boss for a cryptic ID and expect compliance.
- **Blocker**: signup forces them to create a workspace before they can join one. A team-joiner has no reason to create a separate workspace.
- **High**: after signup + join, Dev has no clear indication of what permissions they have. Can they update metrics? Trade? Propose proposals? Nothing on screen says.
- **High**: the workspace is public / open visibility-wise but Dev doesn't know that and can't tell what "Open" means for their role.
- **High**: "Open" workspace gives Dev trade capability but no UI prompt to trade; the affordance is hidden behind "Markets" which is a nav item not a CTA.
- **Medium**: the "1000 free credits on signup" language confuses a team-joiner. It reads as gamification, not enterprise software.
- **Medium**: Dev wants to invite other teammates but only admins can do so; the UI doesn't explain why the invite link is missing from their view.
- **Low**: "workspace" terminology is inconsistent with "team" terminology the team already uses in Slack/Notion.

## Conversion criteria

Ends the session as a member of the target workspace, having viewed at least the metrics page, and understands whether they're read-only, trader, or admin. Says "yeah I see what she set up".

## Bounce criteria

Cannot find the workspace they were invited to. Or: signs up, lands in a create-workspace flow, realizes the join step is separate and obscure, leaves. Or: signs up, joins, has no idea what they're allowed to do, does nothing, closes tab.

## Executor notes

- This persona has to be run end-to-end with two accounts: one "inviter" (pre-existing) who created the workspace and got a link, and one fresh "invitee" who uses the link. Do not shortcut by logging in as the inviter and then using the same session to "join" - that's not the invitee flow.
- Specifically verify `POST /api/marketplace/:id/join` is discoverable through the UI from the invitee's perspective (anonymous view → sign up → back to workspace URL → "join workspace" button).
- Verify which role the invitee gets (viewer, trader, admin) and whether the UI tells them.
- The "Open" workspace visibility mode should give trade capability. Confirm the UI reflects this post-join.
