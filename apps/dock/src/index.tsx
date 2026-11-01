import { render } from 'solid-js/web';
import { App } from './App';
import '@chatdom/ui/kit.css';
import './style.css';

render(() => <App />, document.getElementById('app')!);
