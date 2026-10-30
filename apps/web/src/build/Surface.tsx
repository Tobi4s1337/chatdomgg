import { ErrorBoundary, lazy, Show, Suspense, type Component } from 'solid-js';
import type { BuildToolsController } from '@chatdom/shared';
import FallbackTools from './Tools';
import type { BuildImportBridge } from './session';

const toolsModules = import.meta.glob<{ default: Component<{ controller: BuildToolsController }> }>('../build-tools/index.tsx');
const importModules = import.meta.glob<{ default: Component<BuildImportBridge> }>('../vox-import/index.tsx');
const loadTools = toolsModules['../build-tools/index.tsx'], loadImport = importModules['../vox-import/index.tsx'];
const LaneTools = loadTools ? lazy(loadTools) : null, ImportTool = loadImport ? lazy(loadImport) : null;

export interface BuildToolsProps { controller: BuildToolsController; ownerName?: string; imports?: BuildImportBridge }

/** Optional lanes receive the live bridge. An absent lane adds no inert button or success state. */
export function BuildTools(props: BuildToolsProps) {
  const fallback = () => <FallbackTools {...props} />;
  return <div class="build-composition" data-chatdom-build>
    <ErrorBoundary fallback={fallback}><Suspense fallback={fallback()}>
      <Show when={LaneTools} fallback={fallback()}>{View => { const ToolView = View(); return <ToolView controller={props.controller} />; }}</Show>
    </Suspense></ErrorBoundary>
    <Show when={ImportTool && props.imports && props.controller.snapshot().mode === 'SIMULATED'}>
      <div class="build-import-tools"><ErrorBoundary fallback={<p role="status">The import tools could not open. Your draft is safe.</p>}>
        <Suspense fallback={<p role="status">Opening the import tools…</p>}>
          <Show when={ImportTool}>{View => { const ImportView = View(); return <ImportView {...props.imports!} />; }}</Show>
        </Suspense>
      </ErrorBoundary></div>
    </Show>
  </div>;
}
