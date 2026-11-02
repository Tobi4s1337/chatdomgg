import NAMES from './language-names-1.json';

/** Presentation only. Neither these strings nor review changes enter frozen geography. */
export interface LanguageName { readonly label: string; readonly mapLabel?: string; readonly note?: string }
export interface LanguageNameTable {
  readonly version: number;
  readonly kind: string;
  readonly id: string;
  readonly review: { readonly status: string; readonly proposedAt: string; readonly reviewedBy: string | null; readonly reviewedAt: string | null };
  readonly names: Readonly<Record<string, LanguageName>>;
}
export const LANGUAGE_NAMES: LanguageNameTable = NAMES;

/** Unknown input never borrows another language's name or reveals an unchecked code as display text. */
export function languageName(code: string, table: LanguageNameTable = LANGUAGE_NAMES): LanguageName {
  const key = code.trim().toLowerCase();
  return Object.hasOwn(table.names, key) ? table.names[key]! : { label: 'Unlisted language' };
}

/** Compatibility for earlier Atlas callers; no native-script headline and no locale-dependent lookup. */
export function languageNames(code: string): { name: string; englishName: string } {
  const { label } = languageName(code);
  return { name: label, englishName: label };
}

/** The map may use a contextual, multi-line form while cards keep the plain language name. */
export function languageMapLabel(code: string, table: LanguageNameTable = LANGUAGE_NAMES): string {
  const name = languageName(code, table);
  return name.mapLabel ?? name.label;
}
