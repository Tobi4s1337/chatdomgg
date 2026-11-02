# Panel painter

This private web surface paints approved founded geometry and committed public presence using the kingdom scene.
It has no fixture source, sign-in or allocator. The runner gets public data through the realm's authenticated panel
door. Its secrets stay in Node; the browser receives only the public snapshot and hash-checked scene bytes.

Run the built web app and the lane's realm and gateway on isolated ports between 5170 and 5186, then run:

```sh
node --env-file=/tmp/panel-painter.env apps/web/src/panel-painter/runner.mjs
```

The environment file supplies these values:

- `PANEL_PAINTER_WEB_ORIGIN`: origin serving the web build, for example `http://localhost:5170`.
- `PANEL_PAINTER_API_ORIGIN`: origin serving `/api/panel/v1/stills`.
- `PANEL_PAINTER_REALM_ORIGIN`: isolated realm origin serving the internal panel door and `/api/realm/clock`.
- `PANEL_PAINTER_KINGDOM_IDS`: comma-separated channel IDs; one warm page per configured kingdom, up to 16.
- `REALM_INGRESS_PANEL_SECRET`: realm panel door bearer credential.
- `PANEL_PAINTER_SECRET`: separate upload bearer credential, at least 32 characters.

Add `--once` for one pass. SIGINT/SIGTERM closes its browser. Source and upload errors keep the previous picture;
the runner retries on its next pass without exposing response bodies or credentials in logs. Browser work uses the
repository's shared capture lock. Render loops pause between captures, but the page and loaded scene stay warm.

For a real-GPU still, run inside `chatdom-pc-lease`, serve this build on its reserved lane port 5192, set
`PANEL_PAINTER_WEB_ORIGIN=http://localhost:5192` and `PANEL_PAINTER_CDP_ORIGIN=http://127.0.0.1:9333`, and use `--once`.
Playwright creates and closes only its own browser context. The existing Chrome remains open. The public-data binding
and shared-clock route work over CDP, so neither a browser credential nor an additional HTTP bridge is needed. Keep
the realm and API origins on their isolated lane ports: Node makes those requests on this host. Pass
`--evidence-dir work/evidence/panel-window/painter` to save the browser PNG and uploaded WebP for review.

Live captures are at most once per minute; their revision includes the shared clock minute. Resting captures are at
most once per hour and require a change in geometry, public windows, stream state or committed moment. Heartbeat-only
sequence/time changes do not cause resting captures. Failed uploads never advance the successful capture watermark.

Chrome takes a PNG screenshot, then Chrome encodes that screenshot to WebP, reducing quality/resolution until it fits
60 KiB. The API receives raw `image/webp` and `X-Chatdom-Kingdom-Id`, `X-Chatdom-Captured-At` (realm epoch milliseconds),
and `X-Chatdom-Revision` headers. Every upload uses `PANEL_PAINTER_SECRET`, never an extension JWT.

Each upload also names the painting's lit windows in `X-Chatdom-Windows` (`slot:x:y`, comma-separated, x and y in
ten-thousandths of the frame). The page reads them from the frozen frame's own camera (`captureView()`) and the same
public houses the scene lights. Each position is the first authored pane of a house, which is the glass
`createWindowLights` makes glow. Windows outside the frame or behind the camera are left out, and so is glass that
faces away from the camera or that a sightline shows is hidden. The sightline (`createSight`) runs from the eye to the
glass through the voxel boxes of every placement the renderer draws (homes, civic buildings, props and trees) and over
the land (`terrainHeight`, read once per metre and skipped where an eight-metre tile's ceiling lies below the line).
Authored windows sit in a recess inside their own wall, so the building whose bounds hold the glass is left out of its
own sightline. The panel marks a viewer's window only when the realm confirms it lit and this painting lists it, so
the mark never runs ahead of the picture.

The shot (`paintingView`) is the renderer's hero shot whenever every lit window shows in it, and on an empty night.
Otherwise the page tries the hero composition turned around the castle (0, ±25, ±50 and ±75 degrees), each re-centred on
the lit glass and the keep and stepped back along its own line until they fit. It keeps the turn that shows the most lit
glass, nearest first on a tie. A turn whose eye is under the land, whose view of the keep is behind a hill or whose
picture loses the castle is skipped. When no turn shows more than the hero does, the hero shot stays.

Missing geometry, public presence or shared clock gives no new painting. Unfounded waiting land needs the land owner's
bare-land composition: the existing kingdom scene adds civic buildings even when homes are empty, so it cannot serve
as an honest private waiting-land sketch yet.

The proposed grand-world seam is an early branch in `kingdom/scene.ts`, before any settlement or simulation is
constructed. The owner must implement its bare-land composition and preserve existing callers' return contracts;
this is an integration request, not a patch that can be applied without the new implementation:

```diff
+import { createWaitingLandScene } from './waiting-land-scene';
```

Add `waitingLand?: { readonly channelId: KingdomId }` to `SceneOptions`, then at the start of `createKingdomScene`:

```diff
+  if(options.waitingLand){
+    if(options.founded||options.potential||options.presenceFeed||options.walkerFeed||options.forgeFeed||options.momentFeed||options.dockFeed)throw new Error('Waiting land cannot carry founded state or people');
+    if(options.waitingLand.channelId!==options.kingdomId||options.seed!==`channel:${options.waitingLand.channelId}`)throw new Error('Waiting land must come from its channel');
+    return createWaitingLandScene(canvas,options);
+  }
```

The new composition must reuse the owner's terrain, water, sky and flora pipeline and the existing presentation
methods (hour, camera, readiness, suspend, dispose). It must not construct homes, civic placements, a presence
scenario or life/Forge effects. Hiding settlement meshes is insufficient: those effects would float over empty land.
The existing scene also unconditionally constructs a presence scenario and dereferences its first home, so an empty
home list is not a safe substitute. No renderer or generator edits were made by the painter.

Focused checks:

```sh
node --test apps/web/src/panel-painter/policy.test.mjs apps/web/src/panel-painter/runner.test.mjs
pnpm exec eslint apps/web/src/panel-painter apps/web/src/main.tsx
```
