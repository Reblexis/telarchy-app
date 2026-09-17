# "Publish said ok and traffic never moved" (2026-09-17)

Twice on 2026-09-17 a press of Publish answered `{"ok":true}` and telarchy.com
kept serving the old revision, and each time someone ran `gcloud run services
update-traffic` by hand and concluded the button was broken.

It was not. The Cloud Run audit log for the second press (18:47:07Z, revision
api-02304-kej) shows the button's ReplaceService accepted, generation 2304 to
2305, with a traffic spec identical field for field to the one gcloud sent 62
seconds later; gcloud's request was a no-op against a service already rolling
out (`Ready: Unknown`). Ready came at 18:50:38Z, three and a half minutes after
the press. The first press (16:58:09Z) went Ready at 17:02:51Z, 4.7 minutes.

The defect was the stripe: it said "Published. telarchy.com is serving this
build." the moment the request was accepted, so a correct check a minute later
read as a failure.

Fixed: `GET /api/admin/release` reports `publishing`, the stripe says
"Publishing. telarchy.com switches to this build in a few minutes." and says
Published only when the running revision is the serving one
(docs/infra/deploy.md, "A press is not yet a publish").

Not known: why Cloud Run needs three to five minutes to move traffic to a
revision that is already warm at min-instances 1.
