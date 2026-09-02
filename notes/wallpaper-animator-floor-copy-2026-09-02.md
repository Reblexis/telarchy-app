# Wallpaper Animator floor copy rewritten (2026-09-02)

Owner ask (Viktor, 2026-09-02): "can you make the wallpaper animator what
is this market and what is wllapper animator descriptiont more clear and
intuitive with links". Drafted with the human-writing skill, shown to
Viktor in full, published on his "publish" as Viktor36 (platform admin,
manage on the floor) through `PUT /api/workspaces/:id/settings`
(`subjectAbout`) and `PUT /api/metrics/:id` (`description`, logged as a
revision, market not voided). Workspace `f8627e7f`, metric `54617db8`.

Both texts follow the LookPilot floor's shape: plain first sentence, then
what moves the number, then bare URLs on their own lines (the subject
section linkifies bare URLs, the metric section renders markdown).

Facts kept from the previous text: $4.99 at the 19 April 2026 launch,
$6.99 since 4 August 2026, -30% sale from 4 September, back to $4.99 around
11 September, refunds around 12% of units, Valve's one-day lag, month
closed within 3 days. Settlement rule unchanged word for word in meaning:
daily net_sales_usd for app 4484970 times 0.70, 30 Pacific days ending on
Valve's latest published day, contract payouts not subtracted.

Open calls left with Viktor (unanswered at publish, so the draft's choice
stands): the previous text named the publisher as Fashtag s.r.o. while the
Steam store lists "Kinett", so the new text names no company; "read on
three dates" became "read on several dates" because the floor prices
day, week, month and year; the sync-script sentence stays without a link
because the script lives in the app's private repository.

## Published: What is Wallpaper Animator?

Wallpaper Animator is a desktop app for Windows and Linux, sold on Steam, that plays animated wallpapers on your screen. You can pick from wallpapers other users made, import your own image or video, or type a prompt and let AI generate an image and animate it into a loop. One purchase, no subscription, $6.99 today. Steam is its only source of revenue, so every copy sold on Steam is what this market is betting on.

What moves the number. The price was $4.99 at the Early Access launch on 19 April 2026 and has been $6.99 since 4 August 2026. A 30% sale starts 4 September 2026, and around 11 September the price goes back to $4.99 for good. Steam's seasonal sales (Autumn in late September, Winter in late December) lift units. Refunds run around 12% of units. Valve publishes each day's sales the next day, so the latest reading is about a day behind, and a month's final figure lands within 3 days after the month ends.

More about Wallpaper Animator:
- Steam store page: https://store.steampowered.com/app/4484970/Wallpaper_Animator/
- SteamDB, third-party sales estimates: https://steamdb.info/app/4484970/

## Published: What is this market?

What Wallpaper Animator earned on Steam in the last 30 days, in USD, after Valve's cut, refunds, chargebacks and tax. Steam is its only sales channel, so this is the whole business in one number.

How it is computed: Valve's daily net_sales_usd for Steam app 4484970 (already net of refunds, chargebacks and tax), times 0.70 for Valve's 30% revenue share, summed over the 30 Pacific-time days ending on the latest day Valve has published, which is normally yesterday. A refund counts against the day of the purchase, so past days get adjusted as refunds land. Contract payouts are NOT subtracted.

One number, read on several dates: a market settles on this value as of its resolution instant. Synced daily from the Steam Partner financial API by telarchy-sync (scripts/telarchy-sync.py in the app's own repository).

Store page: https://store.steampowered.com/app/4484970/Wallpaper_Animator/
