// panel.html and mobile.html: the viewer's panel, in the 318 px slot or the phone sheet.
import { render } from 'solid-js/web';
import Panel from '../Panel';

const root = document.getElementById('root');
if (!root) throw new Error('The panel has no root element');
render(() => <Panel />, root);
