import { AppTokenSession, HelixReader } from '@chatdom/twitch';
import { inspectAuthorization } from './auth/authority';
import { runAuthorize } from './auth/authorize';
import type { Role } from './auth/grants';
import { formatAuthorizeOutcome, formatAuthReport } from './cli/report';
import { loadConfig } from './config';

const USAGE = [
  'Usage: herald <command>',
  '  check-auth [--json]                     which real reads are authorized, and how to fix what is not',
  '  authorize --role reader|broadcaster     ask one account for its Herald grant (interactive)',
];

export async function main(argv: readonly string[]): Promise<number> {
  const args = argv.filter(arg => arg !== '--');
  const [command, ...rest] = args;
  const print = (line: string) => process.stdout.write(`${line}\n`);

  if (command === 'check-auth') {
    const config = await loadConfig();
    const tokens = config.credentials ? new AppTokenSession({ clientId: config.credentials.clientId, clientSecret: config.credentials.clientSecret, fetch }) : null;
    let report;
    try {
      report = await inspectAuthorization({ config, tokens, helix: tokens ? new HelixReader({ tokens, fetch }) : null });
    } finally {
      tokens?.close();
    }
    if (rest.includes('--json')) print(JSON.stringify(report, null, 2));
    else formatAuthReport(report).forEach(print);
    return report.ok ? 0 : 1;
  }

  if (command === 'authorize') {
    const roleIndex = rest.indexOf('--role');
    const role = roleIndex >= 0 ? rest[roleIndex + 1] : undefined;
    if (role !== 'reader' && role !== 'broadcaster') {
      USAGE.forEach(line => process.stderr.write(`${line}\n`));
      return 2;
    }
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.once('SIGINT', onSignal);
    try {
      const outcome = await runAuthorize({ config: await loadConfig(), role: role satisfies Role, fetch, print, signal: controller.signal });
      print('');
      formatAuthorizeOutcome(outcome).forEach(print);
      return outcome.status === 'recorded' ? 0 : 1;
    } finally {
      process.off('SIGINT', onSignal);
    }
  }

  USAGE.forEach(line => process.stderr.write(`${line}\n`));
  return 2;
}

main(process.argv.slice(2)).then(code => {
  process.exitCode = code;
}, (error: unknown) => {
  process.stderr.write(`herald: ${error instanceof Error ? error.name : 'Error'} (details withheld)\n`);
  process.exitCode = 1;
});
