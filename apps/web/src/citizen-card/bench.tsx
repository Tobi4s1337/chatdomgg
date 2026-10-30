import { render } from 'solid-js/web';
import CitizenCardBench from './CardBench';

const root = document.getElementById('root');
if (!root) throw new Error('The card bench has no root element.');
render(() => <CitizenCardBench />, root);
