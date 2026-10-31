import { render } from 'solid-js/web';
import EmoteBench from './bench';

// Standalone entry for the emote workshop. The shared router stays untouched; main can mount the
// same default export at /-/emotes when it binds the lane.
const root = document.getElementById('root');
if (!root) throw new Error('Missing emote bench root');
render(() => <EmoteBench />, root);
