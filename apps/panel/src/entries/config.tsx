// config.html and live_config.html: the streamer's views of the panel.
import { render } from 'solid-js/web';
import Config from '../Config';

const root = document.getElementById('root');
if (!root) throw new Error('The panel settings have no root element');
render(() => <Config live={document.body.dataset.surface === 'live_config'} />, root);
