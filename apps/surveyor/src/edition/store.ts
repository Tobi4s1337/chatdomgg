import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { KeyObject } from 'node:crypto';
import type { LedgerState } from './ledger';
import { EditionIdSchema, FoundingSchema, LedgerHeadSchema, type Founding, type LedgerHead } from './schema';
import { verifyEdition, type EditionFiles, type EditionReport } from './verify';

/** `<dataDir>/editions/<ed-0|ed-1>/`; see edition/schema.ts for the files. */
export const editionsRoot = (dataDir: string) => join(dataDir, 'editions');
export const editionDir = (dataDir: string, id: string) => join(editionsRoot(dataDir), EditionIdSchema.parse(id));
export const FOUNDINGS_LOG = join('ledger', 'foundings.ndjson');

function writeDurable(path: string, bytes: Uint8Array | string): void {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, typeof bytes === 'string' ? Buffer.from(bytes) : bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function listEditions(dataDir: string): string[] {
  const root = editionsRoot(dataDir);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => EditionIdSchema.safeParse(name).success).sort();
}

export function readEditionFiles(dataDir: string, id: string): EditionFiles {
  const dir = editionDir(dataDir, id);
  const read = (name: string) => readFileSync(join(dir, name));
  const headsText = existsSync(join(dir, 'heads.ndjson')) ? read('heads.ndjson').toString('utf8') : '';
  return {
    edition: JSON.parse(read('edition.json').toString('utf8')) as unknown,
    worldBytes: new Uint8Array(read('world.json')),
    taxonomyText: read('taxonomy.json').toString('utf8'),
    ledgerText: read('ledger.ndjson').toString('utf8'),
    heads: headsText.split('\n').filter(Boolean).map((line) => LedgerHeadSchema.parse(JSON.parse(line))),
    founding: existsSync(join(dir, 'founding.json')) ? FoundingSchema.parse(JSON.parse(read('founding.json').toString('utf8'))) : null,
  };
}

export function verifyEditionDir(dataDir: string, id: string, founderKey: { key: KeyObject; fingerprint: string } | null): EditionReport {
  let files: EditionFiles;
  try {
    files = readEditionFiles(dataDir, id);
  } catch (error) {
    return {
      problems: [`${id} unreadable: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`],
      edition: null, world: null, state: null, stats: { settlers: 0, byReason: {}, outer: 0, tombstoned: 0, nights: 0, heads: 0 },
    };
  }
  return verifyEdition(files, founderKey);
}

const headLine = (state: LedgerState, revision: string, at: number): string =>
  `${JSON.stringify(LedgerHeadSchema.parse({ version: 1, lines: state.lines, settlers: state.settlers.length, head: state.head, revision, at }))}\n`;

/**
 * Writes a new edition into staging, verifies it completely, then renames it into place. An existing edition is
 * never replaced: founding happens once.
 */
export function writeNewEdition(
  dataDir: string,
  input: { id: string; edition: unknown; founding: Founding; worldBytes: Uint8Array; taxonomyText: string; ledgerText: string; state: LedgerState; now: number },
  founderKey: { key: KeyObject; fingerprint: string },
): void {
  const target = editionDir(dataDir, input.id);
  if (existsSync(target)) throw new Error(`${input.id} already exists; an edition is founded once.`);
  const root = editionsRoot(dataDir);
  const staged = join(root, `.staging-${input.id}-${process.pid}`);
  mkdirSync(staged, { recursive: true });
  try {
    writeDurable(join(staged, 'edition.json'), `${JSON.stringify(input.edition, null, 2)}\n`);
    writeDurable(join(staged, 'founding.json'), `${JSON.stringify(input.founding, null, 2)}\n`);
    writeDurable(join(staged, 'taxonomy.json'), input.taxonomyText);
    writeDurable(join(staged, 'world.json'), input.worldBytes);
    writeDurable(join(staged, 'ledger.ndjson'), input.ledgerText);
    writeDurable(join(staged, 'heads.ndjson'), headLine(input.state, input.founding.revision, input.now));
    fsyncDir(staged);
    const report = verifyEdition({
      edition: input.edition, worldBytes: input.worldBytes, taxonomyText: input.taxonomyText, ledgerText: input.ledgerText,
      heads: [LedgerHeadSchema.parse(JSON.parse(headLine(input.state, input.founding.revision, input.now)))], founding: input.founding,
    }, founderKey);
    if (report.problems.length) throw new Error(`The new edition failed verification: ${report.problems.slice(0, 3).join(' ')}`);
    renameSync(staged, target);
    fsyncDir(root);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

export interface Settlement {
  /** The verified edition files the new lines extend; the ledger on disk must still be exactly these bytes. */
  files: EditionFiles;
  text: string;
  next: LedgerState;
  revision: string;
  now: number;
}

/**
 * Appends one settlement to an edition's ledger. Before anything is written, the edition as it would stand (old
 * ledger + new lines, every head + the new one) is verified completely with the founder key: world hash, chain,
 * owners, land, lattice, overlaps and founding. Only an edition that passes replaces the old ledger. The new ledger
 * is written beside the old, fsynced and renamed over it, so a reader sees the old ledger or the new one, never a
 * torn line; then the new head is acknowledged. A crash between the two leaves an unacknowledged tail that check
 * reports and the next settle acknowledges after re-verifying it.
 */
export function appendSettlement(dataDir: string, id: string, settlement: Settlement, founderKey: { key: KeyObject; fingerprint: string } | null): void {
  const { files, text, next, revision, now } = settlement;
  const dir = editionDir(dataDir, id);
  const ledgerPath = join(dir, 'ledger.ndjson');
  const current = readFileSync(ledgerPath);
  if (!current.equals(Buffer.from(files.ledgerText))) throw new Error('The ledger changed since it was read; settlement abandoned.');
  const head = LedgerHeadSchema.parse(JSON.parse(headLine(next, revision, now)));
  const report = verifyEdition({ ...files, ledgerText: files.ledgerText + text, heads: [...files.heads, head] }, founderKey);
  if (report.problems.length || report.state?.head !== next.head || report.state.lines !== next.lines) {
    throw new Error(`The settled edition failed verification, so the ledger was not changed: ${report.problems.slice(0, 3).join(' ') || 'its head differs from the settlement.'}`);
  }
  const temp = join(dir, `.ledger-${process.pid}.ndjson`);
  try {
    writeDurable(temp, Buffer.concat([current, Buffer.from(text)]));
    renameSync(temp, ledgerPath);
    fsyncDir(dir);
  } finally {
    rmSync(temp, { force: true });
  }
  acknowledgeHead(dataDir, id, next, revision, now);
}

export function acknowledgeHead(dataDir: string, id: string, state: LedgerState, revision: string, now: number): void {
  const path = join(editionDir(dataDir, id), 'heads.ndjson');
  appendFileSync(path, headLine(state, revision, now));
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function appendFoundingLog(dataDir: string, entry: { at: number; edition: string; outcome: 'founded' | 'rejected'; revision: string | null; problems: string[] }): void {
  mkdirSync(join(dataDir, 'ledger'), { recursive: true });
  appendFileSync(join(dataDir, FOUNDINGS_LOG), `${JSON.stringify({ version: 1, ...entry, problems: entry.problems.slice(0, 8).map((p) => p.slice(0, 240)) })}\n`);
}

export type { LedgerHead };
