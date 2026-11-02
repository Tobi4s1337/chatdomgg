import { lazy } from 'solid-js';
import GrandLiveView from './live';

// Staged landscapes have their own explicit bench; URL query flags cannot switch the public view to a fixture.
const GrandLandBench = lazy(() => import('./bench'));
export default function GrandLandView() {
  return location.pathname === '/-/grand-bench' ? <GrandLandBench /> : <GrandLiveView />;
}
