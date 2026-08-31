# Proposal: a phone app that is the web frontend

Written 2026-08-30, at Viktor's ask: "could we create a phone app that would be
autosynced with the web version? ... the UI would be the same and we wouldnt
have to use 2 different frontends or whatever update in two places we would
just update web frontend and the phone would get synced ... and ofc i want
support for push notifications". Nothing here is decided; it exists so the
choice can be made on facts.

## What is already true

Telarchy has no client-side state to synchronize. Every screen reads and writes
through `https://telarchy.com/api`, so any phone client is another caller of the
same server and "syncing" is not a thing that has to be built. The question is
only which shell the same React frontend runs inside.

Push notifications are also already shipped, not pending. The notification
matrix decided 2026-08-24 has a **mobile** channel that is exactly Web Push:

- `push_subscriptions` rows, one per browser, upserted on endpoint
  (`functions/src/db/schema.ts`), deleted on the first 404/410 from the browser.
- Sending via VAPID in `functions/src/lib/push.ts`; nothing is sent when the
  VAPID keys are unset.
- Per-kind, per-channel toggles in `src/components/AccountDialog.tsx`, which
  registers the service worker on demand the first time a Mobile toggle goes on.
- `public/sw.js` turns a push into a system notification and opens the floor it
  names when tapped.

So the phone already gets Telarchy notifications today, and the server work
usually quoted for this feature (keys, subscription table, send path) is done.

## What is actually missing

**A web app manifest.** `index.html` has no `<link rel="manifest">` and
`public/` has no `manifest.webmanifest`. Without it the site installs as a plain
browser shortcut: it opens with an address bar, does not look like an app, and
on iOS it cannot receive push at all, because Safari delivers Web Push only to a
PWA that was installed to the home screen, and installation requires a manifest
declaring `display: standalone`.

This is roughly twenty lines plus icons at the sizes the platforms ask for
(192, 512, and a maskable variant; the existing `logo-mark.png` is the source).

**A mobile layout pass.** The floor, the market grids and the dependency graph
were laid out for a wide screen. This work is identical under every option below
and is the real cost of "Telarchy on a phone".

## The three shells

**PWA.** One codebase, one deploy. A push to main deploys, and the phone has the
new version the next time it opens. No store, no review, no signing. Android
install and push both work as soon as the manifest exists. On iOS the user must
tap Share, then Add to Home Screen, with no prompt available to nudge them, and
that manual step is the only genuine drawback.

**Capacitor wrapper.** A native shell whose webview loads the same live
frontend, so updates still arrive from the web deploy and there is still one
frontend. Buys a store listing and native push on iOS with no add-to-home-screen
step. Costs an Apple developer account (99 USD/yr), a Google Play registration
(25 USD once), signing and CI setup, and a review cycle of a few days per
submission. App Store guideline 4.2 rejects apps that are only a wrapper around
a website, so a submission that merely loads a URL is a real rejection risk;
bundling the assets locally and adding native capabilities is the usual answer.

**React Native.** A second frontend. Every UI change would then be made twice,
which is the outcome the ask was specifically trying to avoid. Not recommended.

## Recommendation

Ship the manifest first. It is the smallest change on this page, it turns the
existing site into an installable app on both platforms, and it is the thing
currently blocking iOS push. Then look at real install and notification numbers
before spending anything on Capacitor.

The argument for deferring Capacitor is not that it is hard. It is that today it
buys a store listing and a smoother iOS install for a product whose constraint
is not distribution through app stores, and it removes none of the layout work.
That calculation changes the moment iOS users are actually being lost at the
Add to Home Screen step, and at that point the wrapper is a weekend on top of a
frontend that is already installable.

## Open for Viktor

1. Manifest now, Capacitor deferred? Or Capacitor in the same push?
2. The manifest fixes the app name, icon, theme colour and start URL. Proposed:
   name "Telarchy", start URL `/`, standalone display, theme colour from the
   existing dark navy. Start URL could instead be the floor.
3. Is an iOS install prompt wanted (a dismissible "Add Telarchy to your home
   screen" hint shown to Safari users who are not installed)? It is the only
   lever available on iOS, and it is also an interstitial on a marketing site.
4. Which notification kinds should default to mobile-on for a freshly installed
   phone. Today the defaults live in `functions/src/lib/notification-prefs.ts`
   and were set for browsers, not phones.

## Verified on production

`GET https://telarchy.com/api/notifications/push-key` answers
`{"configured":true,...}` as of 2026-08-30, so the VAPID keys are set on the
live service and the mobile channel is genuinely sending, not silently dark.

## Built 2026-08-31

Viktor: "i want the best option .. you can code it yourself in an hour either
way", then "ok". TWA was dropped on his own argument: if iOS is happening
eventually, a TWA is throwaway work. Capacitor for both platforms, shells
loading the live origin.

What landed, on branch `mobile-app-proposal`: `docs/mobile.md` as the governing
doc, the web app manifest and its icons, the `transport` column and FCM
alongside Web Push, the `ensureMobileAddress` entry point, both Capacitor
projects with Telarchy's mark over the scaffold's, and the shell CI. Verified
past the suite: a 6.0MB debug APK, and a signed release bundle built with a
throwaway key that was deleted afterwards.

Still Viktor's to do, and the only remaining blockers: the Apple Developer
Program enrolment, the Play Console registration as an organization (an
individual account owes a 12-tester closed test for 14 days), and the Firebase
project that yields `google-services.json` and takes the APNs key.
