import { parseCardSource, readCardDocument, type CardSource, type CitizenCardDocument } from './contracts';

/**
 * The only way from a trusted source snapshot to something a person may see (spec 19, R3/R4/R9).
 *
 * - Before the subject has ever signed in, their card shows this kingdom's home and nothing of their life
 *   elsewhere: no foreign homes, no castle abroad, no passport.
 * - "Hide my travels" removes the passport whole: no stamps, counts, cursors or kingdom hints survive.
 * - The result is rebuilt and checked against the public schema, so nothing the source carries beyond the
 *   document's own fields (privacy flags, dependencies, repository metadata) can reach a page, frame or image.
 *
 * A corrupt source throws `CardContractError`; callers answer unavailable rather than guessing.
 */
export function projectCard(input: CardSource): CitizenCardDocument {
  const source = parseCardSource(input);
  const { document } = source;
  const disclosed = source.subjectFirstSignedInAt !== null;
  const here = document.key.kingdomId;
  const projected: CitizenCardDocument = {
    ...document,
    homes: disclosed ? document.homes : document.homes.filter(home => home.kingdomId === here),
    castle: document.castle && (disclosed || document.castle.kingdomId === here) ? document.castle : null,
    passport: disclosed && !source.travelsHidden && !document.passport.hidden ? document.passport : { hidden: true },
  };
  return readCardDocument(projected, 'projection');
}
