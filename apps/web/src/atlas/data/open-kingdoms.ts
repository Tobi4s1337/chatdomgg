import { readKingdoms, type OpenKingdom } from '@chatdom/ui/site';

/**
 * The kingdoms chatdom.io opens at its front door (`/api/public/door`). A small channel can have a founded kingdom
 * long before the survey observes it (the survey's floor is a few viewers), and until the first edition is founded
 * no claim puts it on the map. The Atlas still owes a visitor who searches for it the way in, so a name the register
 * does not know is checked against this short list. Read once per page; anywhere the door is not served (a bench,
 * a local build) the list is empty and nothing changes.
 */
let open: Promise<readonly OpenKingdom[]> | null = null;
const read = () => (open ??= readKingdoms().catch(() => []));

const key = (text: string) => text.trim().replace(/^@/, '').toLowerCase();

export function matchOpenKingdom(list: readonly OpenKingdom[], query: string): OpenKingdom | null {
  const wanted = key(query);
  if (!wanted) return null;
  return list.find(kingdom => kingdom.login === wanted || key(kingdom.name) === wanted) ?? null;
}

export async function findOpenKingdom(query: string): Promise<OpenKingdom | null> {
  return matchOpenKingdom(await read(), query);
}
