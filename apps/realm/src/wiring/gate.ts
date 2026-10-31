import { AsyncLocalStorage } from 'node:async_hooks';
import type { RealmDomainCommand } from '@chatdom/shared/realm';
import { digestOf, type PostgresRealmRepositoryOptions, type RealmCommitGuard } from '../persistence';

/** One Forge step waiting for the kingdom's writer on behalf of one coordinator lease. */
interface Caller {
  readonly digest: string;
  readonly live: () => boolean;
  /** The guard saw this step's fact and refused it because the caller's lease had fallen. */
  refused: boolean;
}

const stillCurrent = (caller: Caller) => { try { return caller.live(); } catch { return false; } };

/** Thrown inside the write transaction so it rolls back whole. Never leaves the gate. */
class ForgeStepCanceled extends Error {
  constructor() { super('The Forge caller was cancelled before the write'); this.name = 'ForgeStepCanceled'; }
}

/**
 * The caller's cancellation, checked at the transactional write. `DurableKingdom.execute` gates its own writer lease
 * inside the transaction but not the coordinator's: a wish deleted, a lease aborted or a moderation stop that lands
 * while the step waits in the writer queue or on the kingdom row would otherwise still reserve or attach. This gate is
 * one of the repository's commit guards (`PostgresRealmRepositoryOptions.guards`), so it runs inside the same
 * transaction, after the row lock and the reducer's decision and immediately before the fact row is written. A
 * fallen caller throws there, so the transaction rolls back whole: no fact, no stored outcome, no design claim (the
 * repository's own design guard has already written one by then), no coal movement and no outbox row. The step stays
 * undecided and re-askable under the same command ID by a caller that is still current.
 *
 * Which caller a fact belongs to travels with the call itself (`AsyncLocalStorage`), so concurrent steps, ingress and
 * allocation through the same writer are never judged by somebody else's lease.
 */
export class ForgeWriteGate {
  private readonly callers = new AsyncLocalStorage<Caller>();
  private wired = false;

  /** The repository guard. Facts that are not the current Forge step pass untouched. */
  readonly guard: RealmCommitGuard = async (_tx, fact) => {
    const caller = this.callers.getStore();
    if (!caller || digestOf(fact.body) !== caller.digest) return 'ok';
    if (stillCurrent(caller)) return 'ok';
    caller.refused = true;
    throw new ForgeStepCanceled();
  };

  /** Repository options with this gate among its commit guards. The Forge authority refuses to run until this was called. */
  install<T extends PostgresRealmRepositoryOptions>(options: T): T & { readonly guards: readonly RealmCommitGuard[] } {
    this.wired = true;
    return { ...options, guards: [...(options.guards ?? []), this.guard] };
  }

  /** True once a repository's options were built through `install`. */
  get installed(): boolean { return this.wired; }

  /**
   * Runs one Forge command through the writer with `live` as its caller gate. `canceled` means the gate turned the
   * step away at the write and the transaction rolled back; anything else is the repository's own answer or error.
   */
  async run<T>(command: RealmDomainCommand, live: () => boolean, write: () => Promise<T>): Promise<{ readonly canceled: false; readonly result: T } | { readonly canceled: true }> {
    const caller: Caller = { digest: digestOf(command), live, refused: false };
    try {
      return { canceled: false, result: await this.callers.run(caller, write) };
    } catch (error) {
      // Only the gate's own refusal is a cancellation; a COMMIT reply lost after it passed stays the caller's to resolve.
      if (caller.refused && error instanceof ForgeStepCanceled) return { canceled: true };
      throw error;
    }
  }
}
