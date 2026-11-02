/**
 * The longest wish the Forge reads, in UTF-16 code units. With the seven-character `!forge ` prefix a wish stays
 * within Twitch's 500-character chat message, so a wish that fits in chat is never turned away for its length.
 * A longer wish is refused with a length explanation and never quietly shortened.
 *
 * The Forge's own services accept this length already. The Herald command, `RealmHeraldForgeCommand`,
 * `ForgeRunRequestSchema`, the realm reducer and `FORGE_CHAT_LIMITS.words` still stop at 240 until the coordinated
 * change in `work/lanes/forge-wish/patches/wish-length.patch` lands.
 */
export const FORGE_WISH_WORDS_MAX = 493;
