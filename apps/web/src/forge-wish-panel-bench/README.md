# Forge wish panel review

This isolated Vite page mounts the walk Forge panel against schema-checked staged fixture replies. Open `/src/forge-wish-panel-bench/index.html?state=ready` on the web Vite dev server. States are `signedout`, `consent`, `ready`, `sent`, `working`, `delivered`, `held`, `cold`, `unknown`, `not-sent`, and `rate-limited`; an absent or unknown value selects `ready`. The backdrop is a staged gradient, not a 3D scene. Fixture authorization displays an error and does not navigate.

Capture at 1440×900 and 390×844. Wait for `window.__chatdomReady === true`; `window.__chatdomForgePanelError` reports synchronous mount failures. `window.__forgeBench` holds interaction counts, the last request ID, and `reopen()` for test automation. It never records wish words. Staged outcomes do not establish a real Forge delivery.

For controlled integration tests, `?transport=browser` mounts the default browser transport. The test must intercept all `/api/realm/**` routes before loading the page; unlike fixture mode, this mode otherwise makes real same-origin requests.
