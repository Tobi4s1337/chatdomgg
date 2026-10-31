# Kingdom ambience: Web Audio reference

Studied [MDN Web Audio examples](https://github.com/mdn/webaudio-examples), specifically `step-sequencer` and `stereo-panner-node` at `5582dbc`. The repository's root license is CC0 1.0 Universal.

The sequencer demonstrates a noise buffer through a biquad bandpass and scheduling an amplitude envelope on the audio clock. The panner example places a source with a stereo panner. We take the general techniques of filtered noise, clock-scheduled gain and listener-relative stereo position. Our original phrase uses the existing bounded voice graph, two low-pass filtered noise layers, and equal-power fades for overlapping independent air and shore textures.

We leave the sequencer's notes, rhythms, UI and noise implementation, the panner's media sample and direct destination routing. No reference code or media was copied.

Source pointers: `step-sequencer/index.html:233–244` (gain ramps), `:312–340` (noise/filter), `:431–438` (audio-clock scheduling), and `stereo-panner-node/index.html` (listener-relative stereo). These are reference-repository paths, not installed application files. No copied recordings, code or new dependency.
