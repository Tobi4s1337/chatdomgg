import { renderToString } from 'solid-js/web';
import { HomeProgress } from '../../../../packages/ui/src/growth-card/HomeProgress';
import type { HomeProgressState } from '../../../../packages/ui/src/growth-card/adapter';

export function renderProgress(state: HomeProgressState): string {
  return renderToString(() => <HomeProgress state={state} />);
}
