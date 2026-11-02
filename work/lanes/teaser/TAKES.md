# Takes

Every take in `/srv/chatdom/media/teaser/takes` (outside git), from its sidecar. Written by `node apps/studio/edit/takes-md.mjs` at build
`8c4bfcce` of this worktree. "exact" means every frame's virtual clock value is n/fps with no gap or repeat; frame
counts are recorded against (to − from) × fps. GPU takes ran on Tobias's RTX 5080 through `chatdom-pc-lease`; studio
takes are DOM-only frames rendered here.

| Take | Where | Route | Size | Frames | Clock | State | Frames/min | Renderer | Started |
|---|---|---|---|---|---|---|---|---|---|
| `card-close` | studio (DOM) | `/studio/frame.html?card=close` | 1920×1080@1x png alpha | 420/420 (420 files) | exact | complete | 274.7 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:43 |
| `card-title` | studio (DOM) | `/studio/frame.html?card=title` | 1920×1080@1x png alpha | 360/360 (360 files) | exact | complete | 453.4 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:42 |
| `island-golden` | GPU | `/studio/set.html?scene=grand&channel=tobi4s_&path=island-golden` | 1920×1080@1x jpeg | 420/420 (420 files) | exact | complete | 166.3 | ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5080/PCIe/SSE2, OpenGL ES 3.2) | 2026-11-01T22:30 |
| `island-rise` | GPU | `/studio/set.html?scene=grand&channel=tobi4s_&path=island-rise` | 1920×1080@1x jpeg | 300/300 (300 files) | exact | complete | 175.2 | ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5080/PCIe/SSE2, OpenGL ES 3.2) | 2026-11-01T22:42 |
| `page-S01` | studio (DOM) | `/studio/?shot=S01` | 1920×1080@1x png | 240/240 (240 files) | exact | complete | 97 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:35 |
| `page-S02` | studio (DOM) | `/studio/?shot=S02` | 1920×1080@1x png | 180/180 (180 files) | exact | complete | 109.6 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:40 |
| `page-S03` | studio (DOM) | `/studio/?shot=S03` | 1920×1080@1x png | 240/240 (240 files) | exact | complete | 78.5 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:42 |
| `page-S08` | studio (DOM) | `/studio/?shot=S08` | 1920×1080@1x png | 300/300 (300 files) | exact | complete | 89.5 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:45 |
| `page-S09` | studio (DOM) | `/studio/?shot=S09` | 1920×1080@1x png | 180/180 (180 files) | exact | complete | 191.5 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:48 |
| `page-S10` | studio (DOM) | `/studio/?shot=S10` | 1920×1080@1x png | 120/120 (120 files) | exact | complete | 237.2 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:49 |
| `page-S14` | studio (DOM) | `/studio/?shot=S14` | 1920×1080@1x png | 150/150 (150 files) | exact | complete | 99.8 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:50 |
| `still-S06` | studio (DOM) | `/studio/frame.html?shot=S06` | 1920×1080@1x jpeg | 240/240 (240 files) | exact | complete | 369.8 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:45 |
| `still-S07` | studio (DOM) | `/studio/frame.html?shot=S07` | 1920×1080@1x jpeg | 240/240 (240 files) | exact | complete | 445.8 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-02T00:12 |
| `still-S11` | studio (DOM) | `/studio/frame.html?shot=S11` | 1920×1080@1x jpeg | 240/240 (240 files) | exact | complete | 257.6 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:47 |
| `still-S12` | studio (DOM) | `/studio/frame.html?shot=S12` | 1920×1080@1x jpeg | 240/240 (240 files) | exact | complete | 426.8 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-02T00:13 |
| `still-S15` | studio (DOM) | `/studio/frame.html?shot=S15` | 1920×1080@1x jpeg | 240/240 (240 files) | exact | complete | 547.3 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:49 |
| `still-S16` | studio (DOM) | `/studio/frame.html?shot=S16` | 1920×1080@1x jpeg | 180/180 (180 files) | exact | complete | 391.6 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:51 |
| `still-S17` | studio (DOM) | `/studio/frame.html?shot=S17` | 1920×1080@1x jpeg | 240/240 (240 files) | exact | complete | 300.9 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:52 |
| `still-S18` | studio (DOM) | `/studio/frame.html?shot=S18` | 1920×1080@1x jpeg | 180/180 (180 files) | exact | complete | 346.2 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:53 |
| `still-S20` | studio (DOM) | `/studio/frame.html?shot=S20` | 1920×1080@1x jpeg | 180/180 (180 files) | exact | complete | 432.4 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T23:04 |
| `still-S21` | studio (DOM) | `/studio/frame.html?shot=S21` | 1920×1080@1x jpeg | 240/240 (240 files) | exact | complete | 31.7 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | 2026-11-01T22:54 |
| `stream-dusk` | GPU | `/stream?source=simulated&layout=stage&seam=starting&hour=19.3` | 1920×1080@1x jpeg | 1500/1800 (1534 files) | exact | partial |  | ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5080/PCIe/SSE2, OpenGL ES 3.2) | 2026-11-01T22:20 |
| `stream-show` | GPU | `/stream?source=simulated&layout=stage&mood=show&camera=window&hour=19.6` | 1920×1080@1x jpeg | 1320/1320 (1320 files) | exact | complete | 164.6 | ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5080/PCIe/SSE2, OpenGL ES 3.2) | 2026-11-01T22:34 |
