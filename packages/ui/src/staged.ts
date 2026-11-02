/**
 * Whether this build may carry staged (practice) content at all. The Chatdom panel's Twitch Extension build defines
 * `__CHATDOM_STAGED__` as `false`: every branch guarded by this constant then folds away at build time, so the zip
 * Twitch reviews holds real-data code only. Every other build (the web client, benches, tests) leaves it undefined
 * and keeps staged content, which those surfaces mark themselves.
 */
declare const __CHATDOM_STAGED__: boolean | undefined;
export const STAGED_ALLOWED: boolean = typeof __CHATDOM_STAGED__ === 'undefined' || __CHATDOM_STAGED__;
