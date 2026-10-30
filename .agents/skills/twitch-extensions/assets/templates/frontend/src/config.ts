/**
 * Broadcaster configuration view (config.html): shown in the Extensions manager before/after activation.
 * Writes the BROADCASTER segment of the Configuration Service directly from the frontend (the helper uses
 * the broadcaster's JWT), so no EBS is needed for settings.
 */
import './style.css';
import { $, firstAuth, onPollConfig, savePollConfig, setText, syncTheme } from './lib/ext.ts';

syncTheme();
const form = $('config-form') as HTMLFormElement;

// Pre-fill with the saved config.
onPollConfig((cfg) => {
  if (!cfg) return;
  ($('question') as HTMLInputElement).value = cfg.question;
  const inputs = form.querySelectorAll<HTMLInputElement>('input[name="option"]');
  inputs.forEach((input, i) => (input.value = cfg.options[i] ?? ''));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = ($('question') as HTMLInputElement).value.trim();
  const options = [...form.querySelectorAll<HTMLInputElement>('input[name="option"]')]
    .map((i) => i.value.trim())
    .filter(Boolean);
  if (!question || options.length < 2) {
    setText('status', 'Enter a question and at least two options.');
    return;
  }
  void firstAuth.then(() => {
    try {
      savePollConfig({ question, options });
      // set() is fire-and-forget; give clear feedback (submission best practice: show success state).
      setText('status', 'Saved! You can now activate the extension.');
    } catch (err) {
      setText('status', err instanceof Error ? err.message : 'Save failed');
    }
  });
});
