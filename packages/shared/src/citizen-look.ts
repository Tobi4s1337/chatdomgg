import { TokenSchema, type PersonId } from './identity';

/** Free starting clothes and body recipes, never a subscription, trust or earned-status grant. */
export const CITIZEN_STARTER_LOOKS = ['hearth', 'tide', 'grove', 'clay', 'sun', 'dusk'] as const;
export type CitizenStarterLook = typeof CITIZEN_STARTER_LOOKS[number];
export const CitizenLookIdSchema = TokenSchema.max(64);

/** Server-side selection from verified identity. Publish only the recipe ID, never the input identity. */
export function starterCitizenLook(personId: PersonId): CitizenStarterLook {
  let hash = 2166136261;
  for (let index = 0; index < personId.length; index++) hash = Math.imul(hash ^ personId.charCodeAt(index), 16777619);
  return CITIZEN_STARTER_LOOKS[(hash >>> 0) % CITIZEN_STARTER_LOOKS.length]!;
}
