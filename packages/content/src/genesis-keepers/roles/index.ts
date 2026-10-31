import type { KeeperRole, KeeperRoleDefinition } from '../types';
import { FERRYMAN } from './ferryman/index';
import { INNKEEPER } from './innkeeper/index';
import { LAMPLIGHTER } from './lamplighter/index';

export const KEEPER_ROLE_DEFINITIONS: Readonly<Record<KeeperRole, KeeperRoleDefinition>> = {
  innkeeper: INNKEEPER,
  lamplighter: LAMPLIGHTER,
  ferryman: FERRYMAN,
};

export function keeperRole(role: KeeperRole): KeeperRoleDefinition {
  const found = Object.hasOwn(KEEPER_ROLE_DEFINITIONS, role) ? KEEPER_ROLE_DEFINITIONS[role] : undefined;
  if (!found) throw new Error(`Unknown keeper role ${String(role)}.`);
  return found;
}
