// Development-only entry; never an Extension build input.
import { render } from 'solid-js/web';
import Panel from '../Panel';
import { createFixtureAdapter, fixtureState } from './fixture';
const root = document.getElementById('root');
if (root) render(() => <Panel adapter={createFixtureAdapter(fixtureState(new URLSearchParams(location.search).get('state')))} />, root);
