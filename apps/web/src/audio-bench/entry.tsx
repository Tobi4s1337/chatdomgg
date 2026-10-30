import { render } from 'solid-js/web';
import AudioBench from './index';

const root = document.getElementById('root');
if (!root) throw new Error('Missing sound bench root');
render(() => <AudioBench />, root);
