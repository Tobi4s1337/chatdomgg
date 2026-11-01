# SO10 decisions and handoff

## Decisions

- A kingdom's day comes from an absolute epoch, a stable seed and the kingdom's UTC offset. It never depends on a tab having stayed open. Offline time does not earn presence, make citizens, or consume Forge resources.
- Keepers are civic workers with occupation plaques, no citizen identities, and `light: false`. Only actual viewer presence retires them indoors. Civic street lamps remain separate from citizen windows.
- Walking trips use connected, authored local street polylines at 0.55 metres/second, with pauses. A small kingdom gets the same keeper routines and weather. Missing civic places omit their keeper, rather than fabricating a harbour.
- Weather fronts take hours. Surface wetness and snow use a bounded five-day fading precipitation history; these are art weights, rather than hydrological quantities. The cached animation sampler interpolates minute anchors, independent of observation order, so weather does not visibly step at a minute boundary. Calendar seasons use fixed approximate equinox/solstice dates; the hour does not jump at a season boundary.
- The live renderer keeps authority over its sky hour: a live stream can bring dusk. Daily keeper time and weather remain absolute. Soul presentation does not drive a stream director, move citizens or light their windows.
- Original procedural audio reuses the existing land synthesis kit and calls, credited in the soul audio notices. Soul replaces the old land ambience while mounted; playing two wind/rain beds simultaneously is an integration error. Presence adds instrumental layers and stream mixing leaves a speech pocket.
- No autonomous arrival bell: only an explicitly witnessed arrival, or a visibly labelled simulated review cue, may ring it.
- The review route uses the actual authored Hearth house blueprints in a labelled simulated local street. It demonstrates the owned adapters, not an observed live kingdom. Main owns installing those adapters in the walk and stream paths. The precise proposed changes are supplied separately, without editing main-owned systems.

## References

- `work/references/sky-fog-time.md`: shared sky colours and fog, authored hour grades, stable resources rather than an expensive atmospheric simulation.
- `work/references/water.md`: restrained water response and coherent reflections; no imported ocean simulation.
- Existing `kingdom/home-life`, `kingdom/citizen-scene`, `kingdom/ambience`, `kingdom/sound`, `genesis-biomes` and `stream/mount` were read as the integration baseline. Home smoke, presence and audio lifecycle stay with their existing owners.

## Verification boundaries

The host has no real GPU or audio listening tool. SwiftShader stills and browser OfflineAudioContext renders can demonstrate scene composition, signal, lifecycle and budgets. They cannot demonstrate real-GPU frame timing or subjective instrumental and animal timbres on speakers. Those remain explicit review notes, never claimed as measured.
