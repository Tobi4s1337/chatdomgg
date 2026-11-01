import { connectHelper } from '../helper';
import type { PanelAdapter } from '../model';
import { BACKEND_ORIGIN, createProductionAdapter } from './production';

/** Extension entry points always use the verified backend. Fixtures belong to the dev bench. */
export function selectAdapter(_search?: string): PanelAdapter {
  void _search;
  return createProductionAdapter(connectHelper(), { backend: BACKEND_ORIGIN });
}
