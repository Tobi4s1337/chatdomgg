# Forge emitters

`createForgeEmitters(scene)` owns four fixed-size point pools (four draws): square molten sparks and a falling stream above the anvil, soft lobed chimney smoke, and small gold landing twinkles. Call `update({ time, anvil, activity, fillHeight, landed, strike })` with world-space positions and seconds, including when seeking; no particle state or timers accumulate. `fillHeight` is the contact height in metres above the anvil. At most 18 landed placements are rendered. `activity` and `strike` are clamped to 0–1. `dispose()` removes and frees the pools.

The sparks use ember orange and honey gold, the twinkles muted gold, and the smoke a low-opacity warm grey; the glow stays small instead of producing white halos. The caller owns event timing, positions, lighting, and the surrounding Forge sequence.
