# Soul audio capture evidence

All 21 clips were rendered through the live audio graph and encoded as 64 kbit/s Opus for review. The JSON measurements and FFmpeg loudness values describe the original WAV renders. All clips and checks share build fingerprint `0684b0bfe20f85505be29b1b36511c0e30ff69914e0118779eba64612900665f`. The finalizer passed the signal and source limits, stream attenuation, hamlet, mute/resume/seek, stalled-frame fade and duck assertions.

| Clip | Sample peak | RMS | Peak voices | Peak sources | LUFS | True peak dBFS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [coastal-6-walk](coastal-6-walk.ogg) | 0.054384 | 0.013435 | 6 | 12 | -37.9 | -25.3 |
| [coastal-12-walk](coastal-12-walk.ogg) | 0.059914 | 0.012613 | 6 | 7 | -38.4 | -24.5 |
| [coastal-18-walk](coastal-18-walk.ogg) | 0.058624 | 0.012134 | 5 | 5 | -38.8 | -24.6 |
| [coastal-18-stream](coastal-18-stream.ogg) | 0.027684 | 0.005798 | 5 | 5 | -45.2 | -31.2 |
| [coastal-23-walk](coastal-23-walk.ogg) | 0.066305 | 0.012693 | 1 | 1 | -37.5 | -23.6 |
| [woodland-6-walk](woodland-6-walk.ogg) | 0.032956 | 0.007592 | 5 | 5 | -42.3 | -29.6 |
| [woodland-12-walk](woodland-12-walk.ogg) | 0.046676 | 0.007217 | 6 | 8 | -41.6 | -26.6 |
| [woodland-18-walk](woodland-18-walk.ogg) | 0.030480 | 0.006402 | 5 | 5 | -43.6 | -30.3 |
| [woodland-18-stream](woodland-18-stream.ogg) | 0.013909 | 0.003043 | 5 | 5 | -50.2 | -37.1 |
| [woodland-23-walk](woodland-23-walk.ogg) | 0.036712 | 0.006945 | 1 | 1 | -41.0 | -28.7 |
| [meadow-6-walk](meadow-6-walk.ogg) | 0.031088 | 0.007236 | 5 | 5 | -42.7 | -30.1 |
| [meadow-12-walk](meadow-12-walk.ogg) | 0.046179 | 0.006829 | 6 | 8 | -42.0 | -26.6 |
| [meadow-18-walk](meadow-18-walk.ogg) | 0.029273 | 0.006074 | 5 | 5 | -43.9 | -30.7 |
| [meadow-18-stream](meadow-18-stream.ogg) | 0.013838 | 0.002891 | 5 | 5 | -50.5 | -37.2 |
| [meadow-23-walk](meadow-23-walk.ogg) | 0.034762 | 0.006578 | 1 | 1 | -41.3 | -29.2 |
| [highland-6-walk](highland-6-walk.ogg) | 0.043957 | 0.010658 | 5 | 5 | -39.8 | -27.1 |
| [highland-12-walk](highland-12-walk.ogg) | 0.049808 | 0.010002 | 6 | 7 | -39.9 | -26.0 |
| [highland-18-walk](highland-18-walk.ogg) | 0.045144 | 0.009422 | 5 | 5 | -40.8 | -26.9 |
| [highland-18-stream](highland-18-stream.ogg) | 0.021283 | 0.004499 | 5 | 5 | -47.3 | -33.4 |
| [highland-23-walk](highland-23-walk.ogg) | 0.052784 | 0.009977 | 1 | 1 | -39.0 | -25.5 |
| [meadow-6-hamlet](meadow-6-hamlet.ogg) | 0.028057 | 0.006833 | 2 | 2 | -43.5 | -31.0 |

[Measurements](measurements.json), [loudness](loudness.json), and the [lifecycle](lifecycle.json), [stall](stall.json), and [duck](duck.json) checks are included. Spectrogram PNGs sit beside each clip. The graph's limits are 12 voices and 28 scheduled sources, plus 3 continuous beds. Sample peak and RMS are linear amplitude.

No subjective headphone, speaker, or stream-voice listening was performed; those judgments remain open. The rendered loudness is quiet and needs a real-device and speech-mix review.
