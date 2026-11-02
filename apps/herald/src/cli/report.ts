import type { AuthReport } from '../auth/authority';
import type { AuthorizeOutcome } from '../auth/authorize';
import type { Blocker, Capability, Role } from '../auth/grants';
import { ROLE_SCOPES } from '../auth/grants';
import type { ConfigProblem } from '../config';
import type { ObserveProbe } from '../observe/probe';

const CAPABILITY_LABEL: Readonly<Record<Capability, string>> = {
  chat: 'chat delivery',
  chatters: 'chatters sweep',
  stream: 'stream state',
  revocation: 'revocation notices',
  bits: 'cheers and Power-ups',
  hype: 'hype trains',
  follows: 'follows',
  rewards: 'kingdom rewards',
  polls: 'polls and decrees',
  raids: 'Raid Gate controls',
  shield: 'Shield Mode notices',
};
const CAPABILITY_USE: Readonly<Record<Capability, string>> = {
  chat: 'a message lights its author\'s window; deletes and clears put it out',
  chatters: 'quiet connected people light unnamed windows',
  stream: 'the castle beacon follows the broadcast',
  revocation: 'Herald stops when a grant is withdrawn',
  bits: 'a cheer lights the sky over the town at its rung',
  hype: 'the festival train circles the walls; at level 3 the dragon wakes',
  follows: 'a follower is settled on the edge of town and a sapling is planted by their door',
  rewards: 'channel points ring the bell, call a festival, plant a tree or show your home',
  polls: 'a poll stands as a decree board in the plaza; a colours decree is carried out',
  raids: 'the monarch may start or cancel a raid from this kingdom',
  shield: 'the gate follows the channel\'s Shield Mode',
};
const FILTER = 'pnpm --filter @chatdom/herald';

/** The `check:auth` report: names, IDs and scope names only. Nothing in an AuthReport is secret. */
export function formatAuthReport(report: AuthReport): string[] {
  const lines: string[] = [];
  lines.push(`Herald authorization check · observed ${new Date(report.observedAt).toISOString()}`);
  lines.push('');
  lines.push(`  app token     ${report.appToken.state === 'valid' ? `valid · this client, app identity, expires ${new Date(report.appToken.expiresAt).toISOString().slice(0, 10)}` : `unavailable · ${report.appToken.reason}`}`);
  for (const role of ['broadcaster', 'reader'] as const) lines.push(`  ${role.padEnd(13)} ${accountLine(report, role)}`);
  lines.push('');
  lines.push('Capabilities');
  for (const status of report.capabilities) {
    const label = CAPABILITY_LABEL[status.capability].padEnd(19);
    if (status.available) lines.push(`  ✓ ${label} available · ${CAPABILITY_USE[status.capability]}`);
    else {
      lines.push(`  ✗ ${label} unavailable`);
      for (const blocker of status.blockers) lines.push(`      ${blockerLine(blocker)}`);
    }
  }
  const extra = (['broadcaster', 'reader'] as const).filter(role => report.otherScopes[role].length > 0);
  if (extra.length > 0) {
    lines.push('');
    lines.push('Also granted to this client, unused by Herald');
    for (const role of extra) lines.push(`  ${report.accounts[role].login}: ${report.otherScopes[role].join(' ')}`);
  }
  if (report.failures.length > 0) {
    lines.push('');
    lines.push('Reads that failed (state unknown, not missing)');
    for (const failure of report.failures) lines.push(`  ${failure}`);
  }
  const warnings = report.problems.filter(problem => problem.issue === 'readable_by_others' || problem.issue === 'unreadable' || problem.issue === 'invalid');
  if (warnings.length > 0) {
    lines.push('');
    lines.push('Configuration');
    for (const problem of warnings) lines.push(`  ${problemLine(problem)}`);
  }
  const steps = setupSteps(report);
  lines.push('');
  if (steps.length === 0) lines.push('Every Herald capability is authorized.');
  else {
    lines.push('Setup');
    steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  }
  return lines;
}

function accountLine(report: AuthReport, role: Role): string {
  const account = report.accounts[role];
  if (account.state === 'not_designated') return 'not designated (HERALD_READER_LOGIN)';
  if (account.state === 'not_found') return `${account.login} · no such Twitch account`;
  if (account.id === null) return `${account.login} · not checked`;
  const grant = account.authorized === null ? 'grant not checked' : account.authorized ? `granted ${account.granted.filter(scope => ROLE_SCOPES.broadcaster.includes(scope) || ROLE_SCOPES.reader.includes(scope)).join(' ') || 'no Herald scopes'}` : 'has not authorized this client';
  return `${account.login} → ${account.id} · ${grant}`;
}

function blockerLine(blocker: Blocker): string {
  switch (blocker.kind) {
    case 'app_token': return `app token unavailable: ${blocker.reason}`;
    case 'not_designated': return 'no reader account is designated';
    case 'account_not_found': return `${blocker.login} is not a Twitch account`;
    case 'grant_unchecked': return `${blocker.login}'s grant could not be read`;
    case 'not_authorized': return `${blocker.login} (${blocker.role}) has not authorized this client: needs ${blocker.scopes.join(' ')}`;
    case 'missing_scopes': return `${blocker.login} (${blocker.role}) is missing ${blocker.scopes.join(' ')}`;
  }
}

function problemLine(problem: ConfigProblem): string {
  if (problem.issue === 'readable_by_others') return 'the Twitch secrets file is readable by other users; restrict it to its owner (chmod 600)';
  if (problem.issue === 'unreadable') return `${problem.key} could not be read`;
  return `${problem.key} is not valid`;
}

function setupSteps(report: AuthReport): string[] {
  const steps: string[] = [];
  const has = (key: string) => report.problems.some(problem => problem.key === key && problem.issue === 'missing');
  if (has('TWITCH_CLIENT_ID') || has('TWITCH_CLIENT_SECRET') || has('HERALD_TWITCH_ENV_FILE')) steps.push('Put TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the external secrets file (default ~/.config/chatdom/atlas.env).');
  if (report.appToken.state !== 'valid') return steps.length > 0 ? steps : ['Resolve the app token failure above, then run check:auth again.'];
  const blockers = report.capabilities.flatMap(status => status.blockers);
  if (blockers.some(blocker => blocker.kind === 'not_designated')) steps.push('Designate the Herald reader account: set HERALD_READER_LOGIN in ~/.config/chatdom/herald.env.');
  const needsGrant = new Set(blockers.filter(blocker => blocker.kind === 'not_authorized' || blocker.kind === 'missing_scopes').map(blocker => blocker.role));
  if (needsGrant.size > 0 && (has('HERALD_REDIRECT_URI') || report.problems.some(problem => problem.key === 'HERALD_REDIRECT_URI'))) {
    steps.push('Set HERALD_REDIRECT_URI to a callback already registered for this app on dev.twitch.tv (http://localhost:5195/<path> for the local helper).');
  }
  for (const role of ['reader', 'broadcaster'] as const) {
    if (!needsGrant.has(role)) continue;
    steps.push(`${FILTER} authorize -- --role ${role}   (sign in as ${report.accounts[role].login}; requests ${ROLE_SCOPES[role].join(' ')})`);
  }
  if (blockers.some(blocker => blocker.kind === 'grant_unchecked' || blocker.kind === 'account_not_found')) steps.push('Check the configured logins and Twitch reachability, then run check:auth again.');
  if (steps.length > 0) steps.push(`${FILTER} check:auth   (confirms the recorded grants with the app token)`);
  return steps;
}

export function formatAuthorizeOutcome(outcome: AuthorizeOutcome): string[] {
  switch (outcome.status) {
    case 'recorded': return [`Recorded: ${outcome.login} granted ${outcome.scopes.join(' ')}. The sign-in tokens were discarded, not stored.`, `Next: ${FILTER} check:auth`];
    case 'not_ready': return ['Not ready to ask for consent:', ...outcome.reasons.map(reason => `  ${reason}`)];
    case 'denied': return ['Consent was declined on Twitch. Nothing was granted.'];
    case 'wrong_account': return [`A different Twitch account completed consent; this step needs ${outcome.expected}. Its grant is not used by Herald and can be removed under Twitch Settings → Connections. Sign out of Twitch and run authorize again.`];
    case 'wrong_client': return ['Twitch answered for a different client than the configured app. Check TWITCH_CLIENT_ID in the secrets file.'];
    case 'missing_scopes': return [`Twitch recorded the consent without ${outcome.scopes.join(' ')}. Run authorize again and approve every requested permission.`];
    case 'not_recorded': return ['Consent completed, but Get Authorization By User does not show the grant yet. Run check:auth in a minute.'];
    case 'failed': return [`Authorization did not complete: ${outcome.reason}`];
    case 'expired': return ['No callback arrived before the deadline. Run authorize again when ready.'];
    case 'cancelled': return ['Cancelled. Nothing was granted by this helper.'];
  }
}

const SWEEP_END: Readonly<Record<string, string>> = {
  complete: 'complete',
  page_limit: 'partial: page cap reached',
  deadline: 'partial: deadline reached',
  repeated_cursor: 'partial: Twitch repeated a cursor',
  page_failed: 'partial: a page failed',
  aborted: 'stopped',
};

/** `check:auth --observe`: one real read of each observed state, as conditions and counts only. */
export function formatObserveProbe(probe: ObserveProbe | null): string[] {
  const lines = ['', `Observed once · ${probe ? new Date(probe.observedAt).toISOString() : 'not read'} · counts only, nothing published`];
  if (!probe) return [...lines, '  the broadcaster could not be resolved, so nothing was read'];
  const stream = probe.stream;
  if (stream.state === 'skipped') lines.push('  stream    not read: stream state is unavailable');
  else if (stream.state === 'failed') lines.push(`  stream    unknown: Get Streams failed (${stream.failure})`);
  else if (stream.state === 'offline') lines.push('  stream    offline: Get Streams lists no broadcast');
  else lines.push(`  stream    ${stream.state === 'live' ? 'live' : 'listed but not live (the beacon stays dark)'}${stream.startedAt ? ` since ${new Date(stream.startedAt).toISOString()}` : ''}`);
  const chatters = probe.chatters;
  if (chatters.state === 'skipped') lines.push('  chatters  not read: the chatters sweep is unavailable');
  else {
    const people = `${chatters.connected} connected${chatters.duplicates ? ` (${chatters.duplicates} repeats dropped)` : ''}`;
    const failure = chatters.failure ? ` (${chatters.failure})` : '';
    lines.push(`  chatters  ${SWEEP_END[chatters.end] ?? chatters.end}${failure} · ${chatters.pages} ${chatters.pages === 1 ? 'page' : 'pages'} · ${people} · ${chatters.durationMs} ms`);
    lines.push('            a running source sweeps each minute only while the broadcast is live; people stay unnamed');
  }
  return lines;
}
