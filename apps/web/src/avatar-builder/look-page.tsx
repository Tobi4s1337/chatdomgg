import { render } from 'solid-js/web';
import { createKingdomAudio } from '@chatdom/audio';
import { sharedCitizenLooks } from '../citizens/look-library';
import { createLookClient, kingdomFromQuery } from './look-client';
import { deviceStore } from './memory';
import { RealmWardrobe } from './play-ui';

/*
 * `/-/avatar-builder`: the real wardrobe on its own page. Signed in, it opens your saved look from the realm
 * (`?kingdom=<id>` brings that kingdom's records, so its earned pieces can be worn); signed out, a carved invitation
 * to sign in with Twitch through the same route the front door uses. Nothing here is a fixture.
 */

const root = document.getElementById('root');
if (!root) throw new Error('The wardrobe page has no root element.');
document.title = 'Your citizen · Chatdom';
document.documentElement.style.background = '#150e0b';
document.body.style.margin = '0';

const audio = createKingdomAudio();
addEventListener('pointerdown', () => void audio.unlock(), { once: true });
const client = createLookClient();
const kingdomId = kingdomFromQuery(location.search);
const library = sharedCitizenLooks();

render(() => <RealmWardrobe client={client} kingdomId={kingdomId} layout="page" sounds={audio} memory={deviceStore()}
  onSaved={(token, look) => { if (token) library.remember(token, look); }} />, root);
