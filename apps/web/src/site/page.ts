// The site's quiet pages (How it works, the imprint, the privacy policy, the terms, the not-found page): the shared
// start and nothing else. Their words are already on the page; this only gives the seal its real state.
import { markReady, startSite } from './site';

markReady([], startSite());
