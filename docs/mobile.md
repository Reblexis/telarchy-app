# Telarchy on a phone

Telarchy on a phone is the Telarchy web frontend. There is one frontend, and a
push to `main` updates every surface at once: the browser, the installed web
app, and the store builds. No client holds its own copy of the UI, and nothing
about a phone client is synchronized, because no client keeps state to
synchronize: every screen reads and writes through the same API.

Three shells run that one frontend.

| Shell | What it is | How it updates |
|---|---|---|
| Browser | telarchy.com in a tab | On deploy |
| Installed web app | The same origin added to the home screen, opened without browser chrome | On deploy |
| Store build | An Android or iOS app whose webview loads the same origin | On deploy, for everything but the shell itself |

A store build is a shell around the live site, not a copy of it. Only a change
to the shell (native permissions, the push transport, the launch screen) needs
a new store submission; every product change reaches store users the same way
it reaches the web.

## The installable web app

The site declares a web app manifest at `/manifest.webmanifest`, linked from
`index.html`. The manifest is what makes the site installable, and on iOS it is
what makes push possible at all: Safari delivers Web Push only to a site the
visitor has added to the home screen, and it will only install a site that
declares `display: standalone`.

The manifest declares:

- `name` "Telarchy" and `short_name` "Telarchy", the label under the icon.
- `start_url` `/`, so opening the icon lands where the site lands. A signed-in
  visitor is carried to their own view by the same routing the web uses.
- `display` `standalone`, so the installed app opens without an address bar.
- `theme_color` and `background_color` both the site's default surface, bone
  `#fbf9f4`, so the system chrome and the launch screen carry the page's own
  colour instead of flashing a white the product never uses.
- `icons` at 192 and 512 square, plus a `maskable` variant at 512 whose artwork
  stays inside the safe circle, so Android may crop it to the launcher's shape
  without cutting the mark.

The icons are derived from the same source as the site's logo mark. A size the
manifest names but the file tree lacks is a broken install prompt, not a
cosmetic defect, so the sizes and the files are checked together.

## Notifications

The notification matrix in `vision.md` decides WHO is told WHAT over which of
the three channels. This doc owns only the mobile channel's delivery, and adds
one rule to it: **the transport is a property of the address, not of the
notification.** A participant may hold several mobile addresses at once, a
desktop browser and an installed phone app and a store build, and each is
delivered over the transport that address was registered with.

Two transports carry the mobile channel:

- **Web Push (VAPID)** for browsers and installed web apps, on every platform.
- **FCM** for store builds, whose webview cannot receive Web Push. One
  transport covers both stores: Firebase delivers to Android itself and relays
  to iOS over APNs using the auth key uploaded to it, so the server holds one
  native credential instead of two and speaks one protocol instead of two.

Both are rows in `push_subscriptions`, discriminated by a `transport` column
whose absence means `webpush`, because every row written before store builds
existed is a browser.

The sender chooses per row; callers ask for a participant to be notified and
never name a transport. A deployment missing the credentials for one transport
sends over the others and never throws, the same rule Web Push already follows,
so a self-hosted instance with no store builds needs no store credentials.

An address the platform reports as gone is deleted rather than retried: 404 or
410 from a Web Push endpoint, and `NOT_FOUND` or `UNREGISTERED` from FCM. A
failure that is not the platform disowning the address, a timeout or a 500 or a
credential the server got wrong, leaves the row alone: deleting on those would
unsubscribe a working phone because the sender was misconfigured.

## What is deliberately not built

There is no second frontend, and no native UI. A phone-shaped view of a screen
is a responsive layout in the one frontend, governed by `ui-conventions.md`.
Any proposal that renders a Telarchy screen twice is a divergence.
