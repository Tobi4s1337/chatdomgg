/**
 * The longest wish the Forge reads, in UTF-16 code units. With the seven-character `!forge ` prefix a wish stays
 * within Twitch's 500-character chat message, so a wish that fits in chat is never turned away for its length.
 * A longer wish is refused with a length explanation and never quietly shortened.
 * The Herald command, `RealmHeraldForgeCommand`, `ForgeRunRequestSchema`, the realm reducer, the wish box and the
 * Forge's own services all use this one limit.
 */
export const FORGE_WISH_WORDS_MAX = 493;
