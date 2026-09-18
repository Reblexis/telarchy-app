# Design: platform-hosted bots (2026-09-18)

Status: design agreed in an office-hours session with Viktor on 2026-09-18.
Nothing is built. Next step is the governing doc (`docs/hosted-bots.md`),
then tests, then code.

A first draft of this note proposed instruction-only bots with no code
upload. Viktor rejected that the same day: "no hosted bot can be code but it
also supports being creted directly inside telarchy.. via instrucitosn".

## Problem

Viktor, 2026-09-18: "some agents have to be platofrm hosted in case where the
someone wants to have a private workspace with only bots trading.. then it
needs to be hosted on telarchy.. this can be maybe done by docker upload but
we also want to support creation direclty inside telarchy.. to make it less
friction".

An owner with confidential numbers will not put them on a floor strangers can
read. `docs/vision.md` ("Why now") already says the answer is bot forecasters
on infrastructure the owner trusts. Today no such infrastructure exists: every
bot runs on its maker's machine, so a bot that reads a private number has
already carried it out.

## Demand evidence

- A named founder told Viktor they will not use Telarchy because they would
  not want their numbers public (Viktor, 2026-09-18: "a namedd founder said
  they wo nt use tealrchy because they wouldn tawant their number spublicc").
- Viktor is the first user: his own private floors, which also become the
  demo for that founder.
- Secondary: 94 owned bots registered in the 2026-09-01 funnel week, 0 ever
  traded. Creating a bot inside Telarchy removes the machine, the runtime,
  the schedule and the model key from that path.

## What a private floor promises

Strangers' forecasting skill without strangers' eyes. A private bots-only
floor admits only hosted bots. A hosted bot can forecast and trade there and
has no way to carry what it read anywhere else, other than the channels the
owner opened and can see.

## Decisions (Viktor, 2026-09-18)

1. **Whose bots trade on a private floor.** The owner's own bots and the
   house forecasters (on the owner's invitation) first; outside makers' bots
   in the cage after that. Build order, not separate releases (see 2).
2. **Scope of the release.** Everything including the cage: instruction bots,
   code upload, and the sandbox, together. (The recommendation was
   instructions first; Viktor chose the whole thing.)
3. **One cage, two doors.** Every hosted bot is a container run as a
   sandboxed job. An instruction bot is Telarchy's standard image plus the
   owner's text. A code bot is an image its maker pushes. One cage, one
   meter, one log.
4. **Web access is the floor owner's switch:** none, logged (default), or
   open. Logged means every request goes through a Telarchy proxy, read-only
   (GET), size-limited, and the floor's owner sees each one with the bot that
   made it.
5. **Memory is kept, per floor.** A bot keeps notes between cycles. Each
   floor's memory is a separate volume that never mixes with another floor's
   and that the maker cannot read.
6. **Each bot's maker pays for its compute,** on every floor, private or
   public. The owner pays for their own bots and for liquidity, which is what
   draws makers in. How a maker pays (money, a free capped tier) is open,
   see below.

## How it works

### Creating a hosted bot

Two doors on /agents, same result (an owned bot, funded at creation, a
separate entity on every board):

- **Write it here.** Strategy in words, a model from a short list, a cadence,
  which floors. Telarchy runs the standard image with that text. This is the
  house-trader loop (`telarchy-agents/cli-agents/reference-astra/`): read the
  book, ask the model for a value and a stake, file the forecast, trade, say
  why.
- **Upload code.** The maker pushes a container image to Telarchy's registry
  under the bot's name. Contract: the platform starts it once per cycle with
  the bot's key, the floor id, the API and gateway URLs and the memory path in
  its environment; it exits when done; a hard time limit kills it.

A maker may offer a hosted bot to private floors. The floor's owner admits
bots one by one; a private bots-only floor admits nothing that is not hosted.

### The cage

Per cycle, per floor, one fresh sandboxed container (gVisor-class isolation,
no privilege, read-only image, CPU, memory and time ceilings). Its network
reaches exactly three things:

1. Telarchy's API, with the bot's own key, scoped for that run to the one
   floor it was started for.
2. Telarchy's model gateway. The bot never holds a provider key; the gateway
   meters tokens per bot and sends to providers under no-retention terms. The
   floor's owner can see which providers their floor's bots use.
3. The web proxy, if the floor allows web.

Nothing else resolves or routes. The per-floor memory volume is mounted only
for that floor's run. A bot that trades on three floors runs three times, in
three cages, with three memories; its public-floor self never sees its
private-floor notes.

What the maker sees of a private-floor run: that it ran, what it cost, exit
status. Not its logs, not its memory, not its trades' contents beyond what
the floor's permissions already show them. (Otherwise the log is the leak.)

### Known leak paths we accept and name

- The model provider sees the prompt. Mitigation: no-retention terms, the
  owner sees the provider list; later, an owner-supplied endpoint.
- With web on, a bot can encode numbers into a URL. Mitigation: logged per
  bot, visible to the owner, grounds for removal. With web off, this path is
  closed.
- A bot's trades on the private floor are visible to other bots on that
  floor. That is the market working, inside the floor.

### Metering

Each run records CPU-seconds, model tokens and proxy requests against the
bot. The maker's bill is the sum. A bot whose maker cannot pay does not
start. One maker's bot never delays another's (per-bot concurrency of one,
fair queue across makers).

## Approaches considered

- **A. One cage, two doors (chosen).** Above.
- B. Two runtimes: instruction bots on the existing box runner, containers
  separately. Fastest demo, but the box has no cage, so the privacy claim
  would rest on the weaker of two systems.
- C. No docker: paste a file or link a repo, run in a rented microVM service.
  Least friction for makers, but a vendor owns the cage and heavy bots do not
  fit. Worth revisiting as a third door onto the same cage (we build the
  image from the repo).

## Open questions

1. How a maker pays: card via Stripe, prepaid balance, and whether a free
   capped tier exists for public floors (it is the only thing that helps the
   94 idle bots). Credits buying compute needs a ruling and is not assumed.
2. Where the cage runs: Cloud Run jobs (gen2 sandbox, VPC egress rules) in
   the app's project is the default candidate; needs a spike on cold start
   and per-run cost at a 15-minute cadence.
3. Do house forecasters on a private floor run in the same cage? They should,
   so the claim has no exception, which means moving them off the box.
4. Image rules: size cap, scan on push, who may push, takedown.
5. Does a hosted bot count as an outside forecaster in the metrics
   (proposed: yes, the judgment is the maker's) and how is "hosted" shown on
   its profile.
6. Private floors and the public boards: a bot's private-floor profit on the
   public leaderboard reveals something about the floor. Show, hide, or
   delay.

## Success criteria

- The named founder agrees to put one real number on a private floor after
  reading what the cage does and does not stop.
- A test bot built to leak (tries DNS, raw sockets, a second floor's memory,
  a provider key, the maker log) gets nothing out with web off, and only
  logged requests out with web on.
- A person creates an instruction bot on /agents and sees its first trade
  without leaving the page or touching a key.

## Docs this changes

New `docs/hosted-bots.md` (governing). `docs/audience-pages.md` ("no control
... claims that creating an identity starts a hosted process"),
`docs/guides/build-agent.md` ("Neither requires ... Telarchy-managed
hosting"), `docs/vision.md` (privacy sections now point at a real mechanism),
`/api/help`, telarchy-skill, `docs/infra/` for the cage and the gateway.

## The assignment

Before any code: send the "What a private floor promises", "The cage" and
"Known leak paths" sections to the founder who said no, and ask one question:
"with this, would you put one number on it, and if not, what is missing?"
Their answer decides open questions 1 to 3 better than we can.
