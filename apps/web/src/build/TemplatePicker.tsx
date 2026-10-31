import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { HOME_BUILD_LIMITS, type BuildDraftPolicy, type BuildToolsController } from '@chatdom/shared';
import { BuildDraft } from '@chatdom/world';
import {
  BUILD_TEMPLATE_CHOICES, BUILD_TEMPLATE_LABELS, BUILD_TEMPLATE_KIT_LABELS,
  createBuildTemplate,
} from '../../../../packages/content/src/templates';
import type { BuildImportBridge } from './session';
import './templates.css';

/** Only finished starting shapes for the actual plot's kit and tier are offered. The draft still validates insertion. */
export function buildTemplateChoices(policy: BuildDraftPolicy) {
  return BUILD_TEMPLATE_CHOICES.filter(choice => choice.style === policy.styleId
    && HOME_BUILD_LIMITS[choice.tier].maxVoxels === policy.maxVoxels
    && HOME_BUILD_LIMITS[choice.tier].height === policy.editableTo[1]);
}

/** A view on the existing build bridge: preview is private, Begin is one ordinary undoable insertion. */
export default function TemplatePicker(props: BuildImportBridge & { controller: BuildToolsController; close(): void }) {
  const choices = buildTemplateChoices(props.draft.policy);
  const [selected, setSelected] = createSignal(choices[0]?.id ?? '');
  const [revision, setRevision] = createSignal(props.draft.revision);
  const [failure, setFailure] = createSignal<string | null>(null);
  onCleanup(props.controller.subscribe(() => setRevision(props.draft.revision)));
  const choice = createMemo(() => choices.find(item => item.id === selected()));
  const prepared = createMemo(() => {
    revision();
    const item = choice();
    if (!item) return null;
    const blueprint = createBuildTemplate(item.style, item.form, item.tier);
    try {
      const trial = new BuildDraft(props.draft.policy, props.draft.serialize());
      trial.insertBlueprint(blueprint, [0, 0, 0]);
      return { blueprint, blocks: trial.voxelCount, error: null };
    } catch (cause) {
      return { blueprint, blocks: 0, error: cause instanceof Error ? cause.message : 'This shape does not fit the plot.' };
    }
  });
  createEffect(() => {
    const next = prepared();
    props.onPreview(next && !next.error ? next.blueprint : null, [0, 0, 0]);
  });
  onCleanup(() => props.onPreview(null, [0, 0, 0]));
  function begin() {
    const next = prepared();
    if (!next || next.error) return;
    try {
      props.draft.insertBlueprint(next.blueprint, [0, 0, 0]);
      props.onChanged();
      props.close();
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'The draft could not take this shape.'); }
  }
  return <section class="build-template-picker" aria-label="Starting shapes" data-build-template-picker>
    <header><h3>A place to begin</h3><button type="button" aria-label="Close starting shapes" onClick={props.close}>Close</button></header>
    <Show when={choice()}>{item => <p class="build-template-kit">{BUILD_TEMPLATE_KIT_LABELS[item().style]}</p>}</Show>
    <div class="build-template-choices" role="group" aria-label="House shape"><For each={choices}>{item =>
      <button type="button" aria-pressed={selected() === item.id} onClick={() => { setFailure(null); setSelected(item.id); }}>{BUILD_TEMPLATE_LABELS[item.form].title}</button>
    }</For></div>
    <Show when={choice()}>{item => <p>{BUILD_TEMPLATE_LABELS[item().form].hint}</p>}</Show>
    <p>Your draft is unchanged while you look. Beginning replaces the whole draft; Undo brings it back.</p>
    <Show when={prepared()}>{next => <>
      <Show when={next().error || failure()} fallback={<p class="build-template-cost">{next().blocks.toLocaleString('en-GB')} blocks · {Math.max(0, props.draft.policy.maxVoxels - next().blocks).toLocaleString('en-GB')} left to make it yours</p>}>
        <p role="alert">{next().error || failure()}</p>
      </Show>
      <button type="button" class="build-template-begin" disabled={!!next().error} onClick={begin}>Begin with this shape</button>
    </>}</Show>
  </section>;
}
