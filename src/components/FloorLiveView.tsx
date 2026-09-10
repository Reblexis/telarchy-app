/**
 * The owner's live view on the public floor (docs/ui-conventions.md, "The
 * live view"): the page the owner named as `liveViewUrl`, framed in a 16:9
 * box directly above "What is <name>?", with one caption line and a link
 * out. Owner ask 2026-09-10, for the Snake floor (a game steered by its
 * market, with a board page on another host): "could you visualize it in
 * telarchy itself?".
 *
 * It is the owner's content, not Telarchy's: the frame is sandboxed to
 * scripts and same-origin so the page can run, and nothing more (no forms,
 * no popups, no top navigation), loads lazily, and sends no referrer. The
 * server accepts https only, so the src is never a javascript: or data: URL.
 * Renders nothing when the URL is null, so a floor without one is untouched.
 */
export function FloorLiveView({ url, name }: { url: string | null | undefined; name: string }) {
  if (!url) return null;
  return (
    <section className="pubws-live pubws-enter pubws-enter--3" aria-label="Live view">
      <div className="pubws-live-box">
        <iframe
          className="pubws-live-frame"
          src={url}
          title={`Live view of ${name}`}
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
      <p className="pubws-live-caption">
        Live view, published by the owner.{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          Open in a new tab
        </a>
      </p>
    </section>
  );
}
