import { render } from 'solid-js/web';
import '../style.css';
import GrowthBench from './index';

// Development entry for the growth sequence while its `/-/growth` route is being mounted by the web app.
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
render(() => <GrowthBench />, root);
