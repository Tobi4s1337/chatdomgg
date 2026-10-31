// @chatdom/web does not declare Zod and apps/api has no manifest yet; both are main-owned.
// Until main adds `zod` to those manifests, every twitch-moments module takes the exact
// Zod instance that @chatdom/shared resolves, so local and shared schemas compose.
export { z } from '../../../../packages/shared/node_modules/zod';
