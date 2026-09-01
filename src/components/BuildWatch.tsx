import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { runningBundlePath, startBuildWatch } from '../lib/build-watch';

/**
 * Mounted once, for every page: a build published while this tab stayed open
 * either reloads the page (coming back from a minute away, nothing typed) or
 * offers itself as this pill. Renders nothing the rest of the time, and
 * nothing at all in dev, where there is no built bundle to compare.
 *
 * Spec: docs/infra/deploy.md, "A tab that is already open picks the new build
 * up"; the pill is docs/ui-conventions.md, "Page layout".
 */
export function BuildWatch() {
  const [available, setAvailable] = useState(false);
  useEffect(
    () =>
      startBuildWatch({
        runningBundle: runningBundlePath(),
        fetchIndexHtml: () => api.getServedIndexHtml(),
        onUpdate: () => setAvailable(true),
        reload: () => window.location.reload(),
      }),
    [],
  );
  if (!available) return null;
  return (
    <button type="button" className="pubws-update" onClick={() => window.location.reload()}>
      new version · reload
    </button>
  );
}
