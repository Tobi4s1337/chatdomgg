import type { PersonId } from '@chatdom/shared';
import type { LookOrigin, LookRepository, StoredGrant, StoredLook } from './ports';

/** In-process storage for tests and benches. Same rules as Postgres: recipes never change, grants are first-wins. */
export class MemoryLookRepository implements LookRepository {
  readonly recipes = new Map<string, string>();
  private readonly looks = new Map<string, StoredLook & { readonly origin: LookOrigin }>();
  private readonly granted = new Map<string, (StoredGrant & { readonly origin: LookOrigin })[]>();
  /** Set to make every call fail as storage trouble would. */
  failing = false;

  constructor(private readonly now: () => number = Date.now) {}

  private check() { if (this.failing) throw new Error('SIMULATED storage failure'); }

  async recipe(token: string) { this.check(); return this.recipes.get(token) ?? null; }

  async current(personId: PersonId, origin: LookOrigin) {
    this.check();
    const look = this.looks.get(personId);
    return look && look.origin === origin ? { token: look.token, recipe: look.recipe, savedAt: look.savedAt } : null;
  }

  async save(personId: PersonId, origin: LookOrigin, token: string, recipe: string) {
    this.check();
    const existing = this.recipes.get(token);
    if (existing !== undefined && existing !== recipe) throw new Error('A token never changes its recipe');
    this.recipes.set(token, recipe);
    const saved = { token, recipe, savedAt: this.now(), origin };
    this.looks.set(personId, saved);
    return { token, recipe, savedAt: saved.savedAt };
  }

  async grant(personId: PersonId, origin: LookOrigin, grant: Omit<StoredGrant, 'grantedAt'>) {
    this.check();
    const list = this.granted.get(personId) ?? [];
    const existing = list.find(g => g.pieceId === grant.pieceId);
    if (existing) return strip(existing);
    const stored = { ...grant, grantedAt: this.now(), origin };
    list.push(stored); this.granted.set(personId, list);
    return strip(stored);
  }

  async grants(personId: PersonId, origin: LookOrigin, limit: number) {
    this.check();
    return (this.granted.get(personId) ?? []).filter(g => g.origin === origin).slice().reverse().slice(0, limit).map(strip);
  }
}

const strip = (g: StoredGrant): StoredGrant => ({ pieceId: g.pieceId, slot: g.slot, source: g.source, title: g.title, recipe: g.recipe, grantedAt: g.grantedAt });
