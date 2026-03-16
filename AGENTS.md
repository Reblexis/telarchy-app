For more info about this project look into docs/vision.md.

Currently we are using openclaw agents for betting, all openclaw configuration is in ~/.openclaw . 

If modifying the api capabilities or otherwise changing behaviour of the backend relevant to api communication, always update the documentation and api help endpoint correspondingly as well as the skill description.

## Error handling convention

Prefer reporting errors over defensive defaults. When something unexpected happens (missing data, failed fetch, unexpected null), surface the error rather than silently substituting a default value:

- **Backend**: Use `console.error(...)` for unexpected state that shouldn't crash the request (e.g. missing metric during event emission, bad formula evaluation). Throw `AppError` for request-level failures. Never use `.catch(() => {})` — at minimum log the error.
- **Frontend**: Surface errors to the user via error state (`setError(e.message)`) or `onError` callbacks. Never use `.catch(() => {})` or `.catch(() => null)` unless the failure is truly expected (e.g. auth token verification in middleware). For data that should always be present, log `console.error` and only then fall back.
- **Avoid `hasattr`/`try-catch` as control flow.** Only use try-catch where errors are genuinely expected (e.g. user-authored formula evaluation). Even then, log the error before returning a fallback.
- **Avoid `|| defaultValue`** where the `undefined`/`null` case would indicate a bug. Use `?? defaultValue` only when the field is genuinely optional. When in doubt, add a `console.error` before the fallback so the unexpected case is visible in logs.