#!/usr/bin/env python3
"""The GK11 kingdom hook for GK10's grand engine, worker and entry. Anchored edits: run with the worktree root
that holds GK10's apps/web/src/grand. GK10 adopts it (or its equivalent) into its own files."""
import sys, re
root = sys.argv[1]

def edit(path, pairs):
    p = f'{root}/{path}'
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'{path}: anchor missing: {old[:80]!r}')
        s = s.replace(old, new, 1)
    open(p, 'w').write(s)

edit('apps/web/src/grand/worker.ts', [
    ("import { landCacheKey,", "import { clearKingdomStructures, seatKingdomOnLand, type SeatedKingdom } from '../../../../packages/world/src/grand/kingdom';\nimport type { SettlementPlan } from '@chatdom/world';\nimport { landCacheKey,"),
    ("| { type: 'generate'; seed: GrandLandSeed }", "| { type: 'generate'; seed: GrandLandSeed; settlement?: SettlementPlan }"),
    ("| { type: 'land'; land: GrandLand; cached: boolean }", "| { type: 'land'; land: GrandLand; cached: boolean; seated?: SeatedKingdom }"),
])
w = open(f'{root}/apps/web/src/grand/worker.ts').read()
# raise(seed) -> raise(seed, settlement): grade after generation, never cache a seated land under the bare seed.
w = re.sub(r"async function raise\(seed: GrandLandSeed\): Promise<void> \{", "async function raise(seed: GrandLandSeed, settlement?: SettlementPlan): Promise<void> {", w, 1)
w = w.replace("const key = import.meta.env.DEV ? null :", "const key = import.meta.env.DEV || settlement ? null :", 1)
m = re.search(r"\n(\s*)adopt\(land\);", w)
if not m: raise SystemExit('worker: adopt(land) missing')
i = m.group(1)
w = w[:m.start()] + (f"\n{i}const seated = settlement ? seatKingdomOnLand(land, settlement) : undefined;"
    f"\n{i}// The land now aims at the town and castle as drawn, and nothing it composed stands over them."
    f"\n{i}if (seated) {{"
    f"\n{i}  const kept = clearKingdomStructures(land.structures, land.structureCount, seated.sites.reserve);"
    f"\n{i}  Object.assign(land, {{ structures: kept.structures, structureCount: kept.count,"
    f"\n{i}    sites: {{ ...land.sites, castle: seated.sites.castle, town: seated.sites.town, focus: [...seated.sites.focus, ...land.sites.focus] }} }});"
    f"\n{i}}}") + w[m.start():]
w = w.replace("cached: cached !== null }", "cached: cached !== null, ...(seated ? { seated } : {}) }", 1)
w = w.replace("raise(message.seed)", "raise(message.seed, message.settlement)", 1)
open(f'{root}/apps/web/src/grand/worker.ts', 'w').write(w)

edit('apps/web/src/grand/engine.ts', [
    ("import type { GrandWorkerReply, GrandWorkerRequest } from './worker';",
     "import type { GrandWorkerReply, GrandWorkerRequest } from './worker';\nimport type { SettlementPlan } from '@chatdom/world';\nimport type { SeatedKingdom } from '../../../../packages/world/src/grand/kingdom';\n\n/** Something drawn with the land (GK11: the kingdom). Lit by the land's hour and updated every frame. */\nexport interface GrandLayer {\n  setLight(hour: number, sunDirection: THREE.Vector3): void;\n  update(seconds: number): void;\n  isReady(): boolean;\n  dispose(): void;\n}"),
    ("  private dirty = true;", "  private dirty = true;\n  private readonly layers: GrandLayer[] = [];\n  /** The settlement seated on this land, when the entry gave one. */\n  seated: SeatedKingdom | null = null;\n  settlement: SettlementPlan | null = null;"),
    ("{ type: 'generate', seed: this.seed }", "{ type: 'generate', seed: this.seed, ...(this.settlement ? { settlement: this.settlement } : {}) }"),
    ("      this.stats.landCached = reply.cached;", "      this.stats.landCached = reply.cached;\n      this.seated = reply.seated ?? null;"),
    ("    this.install(now);\n", "    this.install(now);\n    for (const layer of this.layers) layer.update(this.time);\n"),
    ("    applyGrade(this.uniforms, grade);", "    applyGrade(this.uniforms, grade);\n    for (const layer of this.layers) layer.setLight(this.hour, grade.sunDirection);"),
    ("  setHour(hour: number): void {", "  /** Ask for another frame (a layer installed geometry or changed light). */\n  invalidate(): void { this.dirty = true; this.readyFired = false; }\n\n  addLayer(layer: GrandLayer): void {\n    this.layers.push(layer);\n    layer.setLight(this.hour, grandGrade(this.hour, this.sunAzimuth).sunDirection);\n    this.invalidate();\n  }\n\n  setHour(hour: number): void {"),
    ("    const ready = settled && ", "    const ready = settled && this.layers.every(layer => layer.isReady()) && "),
    ("    this.disposed = true;\n", "    this.disposed = true;\n    for (const layer of this.layers) layer.dispose();\n"),
])
print('hook applied')
# A street view of the seated town (GK11): over the roofs from the castle side, where the citizens are seen walking.
edit('apps/web/src/grand/engine.ts', [
    ("export type GrandView = 'orbit' | 'high' | 'castle' | 'harbour' | 'summit' | 'fields' | 'mere';",
     "export type GrandView = 'orbit' | 'high' | 'castle' | 'harbour' | 'summit' | 'fields' | 'mere' | 'town';"),
    ("export const GRAND_VIEWS: readonly GrandView[] = ['orbit', 'high', 'castle', 'harbour', 'summit', 'fields', 'mere'];",
     "export const GRAND_VIEWS: readonly GrandView[] = ['orbit', 'high', 'castle', 'harbour', 'summit', 'fields', 'mere', 'town'];"),
    ("      case 'mere': {",
     "      case 'town': {\n        const market = (s as { focus?: readonly { id: string; x: number; y: number; z: number }[] }).focus?.find(f => f.id === 'kingdom:market') ?? { x: s.town.x, y: s.town.level, z: s.town.z };\n        place(market.x * M, market.y * M, market.z * M, toward(market, s.castle) + 0.35, 70, deg(30));\n        break;\n      }\n      case 'mere': {"),
])


edit('apps/web/src/grand/index.tsx', [
    ("import './grand.css';", "import './grand.css';\nimport { composeGrandKingdom } from './kingdom/content';\nimport { attachGrandKingdom } from './kingdom/attach';"),
    # The land is raised around the settlement, so the kingdom composes first (in its own worker), then the land.
    ("    void engine.start().then(() => {", "    void composeGrandKingdom(channel.login).then(kingdom => {\n      engine!.settlement = kingdom.content.plan;\n      return engine!.start().then(() => { attachGrandKingdom(engine!, kingdom.content, kingdom.dressing); });\n    }).then(() => {"),
])
print('entry hook applied')
# The town's ground (GK11 grade): paved public ground is its own cover, drawn in the kingdom view's paving colour with
# a slow worn tone (no per-voxel noise), and the settlement's lawns (reserved) carry grass tufts but no flowers.
edit('packages/world/src/grand/types.ts', [
    ("riverbed: 10, lakebed: 11, cliff: 12, reserved: 13, hedge: 14, lava: 15,",
     "riverbed: 10, lakebed: 11, cliff: 12, reserved: 13, hedge: 14, lava: 15, paved: 16,"),
])
edit('packages/world/src/grand/palette.ts', [
    ("  sea: 37,\n", "  sea: 37,\n  /** The kingdom's paved streets and squares (GK11): today's kingdom paving, and its worn tone. */\n  paving: 38, pavingWorn: 39,\n"),
    ("put(M.sea, '#2c6e8a', GrandKind.water);", "put(M.sea, '#2c6e8a', GrandKind.water);\n  put(M.paving, '#b3a28a', GrandKind.earth); put(M.pavingWorn, '#a8977e', GrandKind.earth);"),
])
edit('packages/world/src/grand/voxelize.ts', [
    ("    case Cover.shingle: return depth < 2 ? M.shingle : strata(ctx, x, y, z, warp);",
     "    case Cover.shingle: return depth < 2 ? M.shingle : strata(ctx, x, y, z, warp);\n    case Cover.paved: return depth === 0 ? (ctx.patch(x / 11, z / 11) > 0.42 ? M.pavingWorn : M.paving) : depth < 4 ? M.dirt : strata(ctx, x, y, z, warp);"),
    ("  if (cover !== Cover.meadow && h < 0.5) return M.grass[2];",
     "  if (cover === Cover.reserved || (cover !== Cover.meadow && h < 0.5)) return M.grass[2];"),
])
print('town ground hook applied')


# Size the land to the settlement (run with --size). Without it a town larger than the land's tier island is seated
# with its region running to a straight coast. Cost: land area grows to what the town asks for (tobi4s_ 2560
# columns, PinkKittyRose 2816, MashaD4 2688, The_AGGman 1920 against today's 1280-1792).
if '--size' in sys.argv:
    edit('packages/world/src/grand/plan.ts', [
        ("  const size = SIZES[seed.tier];", "  // A seated settlement asks for at least the land its region and band need (GK11 `landColumnsFor`).\n  const size = Math.max(SIZES[seed.tier], seed.minSize ?? 0);"),
    ])
    t = open(f'{root}/packages/world/src/grand/types.ts').read()
    i = t.index('export interface GrandLandSeed'); j = t.index('}', i)
    t = t[:j] + "  /** The least land, columns per side, a seated settlement needs (GK11 `landColumnsFor`). */\n  readonly minSize?: number;\n" + t[j:]
    open(f'{root}/packages/world/src/grand/types.ts', 'w').write(t)
    w = open(f'{root}/apps/web/src/grand/worker.ts').read()
    w = w.replace("import { clearKingdomStructures, seatKingdomOnLand,", "import { clearKingdomStructures, frameSettlement, landColumnsFor, seatKingdomOnLand,", 1)
    w = w.replace("async function raise(seed: GrandLandSeed, settlement?: SettlementPlan): Promise<void> {",
                  "async function raise(asked: GrandLandSeed, settlement?: SettlementPlan): Promise<void> {\n  const seed = settlement ? { ...asked, minSize: Math.max(asked.minSize ?? 0, landColumnsFor(frameSettlement(settlement))) } : asked;", 1)
    open(f'{root}/apps/web/src/grand/worker.ts', 'w').write(w)
    print('land sizing hook applied')
