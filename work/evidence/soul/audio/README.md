# Soul audio capture evidence

This is a **partial matrix**, not a completed audio review. The seven clips below were rendered through the live audio graph and encoded as 64 kbit/s Opus for review; their JSON measurements describe the original WAV renders. All seven share build fingerprint `0684b0bfe20f85505be29b1b36511c0e30ff69914e0118779eba64612900665f`. The full 21 clips and lifecycle, stall and duck checks have not been finalized or analyzed.

| Clip | Sample peak | RMS | Peak voices | Peak sources |
| --- | ---: | ---: | ---: | ---: |
| [coastal-6-walk](coastal-6-walk.ogg) | 0.054384 | 0.013435 | 6 | 12 |
| [coastal-12-walk](coastal-12-walk.ogg) | 0.059914 | 0.012613 | 6 | 7 |
| [coastal-18-walk](coastal-18-walk.ogg) | 0.058624 | 0.012134 | 5 | 5 |
| [coastal-23-walk](coastal-23-walk.ogg) | 0.066305 | 0.012693 | 1 | 1 |
| [woodland-6-walk](woodland-6-walk.ogg) | 0.032956 | 0.007592 | 5 | 5 |
| [woodland-12-walk](woodland-12-walk.ogg) | 0.046676 | 0.007217 | 6 | 8 |
| [woodland-18-walk](woodland-18-walk.ogg) | 0.030480 | 0.006402 | 5 | 5 |

The graph's limits are 12 voices and 28 scheduled sources, plus 3 continuous beds; these seven captures stayed within those limits. Sample peak and RMS are linear amplitude, not LUFS or true peak. The three lifecycle unit tests passed. No subjective headphone, speaker, or stream-voice listening was performed; those judgments remain open.
