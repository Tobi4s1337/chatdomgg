import { runRestartRealm, runRestartSupervisor } from './restart-proof';
const [role, ...rest] = process.argv.slice(2);
if (role === 'realm') await runRestartRealm(rest[0]!, Number(rest[1]), rest[2] === 'seed');
else if (role === 'supervise') await runRestartSupervisor(Number(rest[0]), process.argv[1]!);
else throw new Error('The restart proof needs the supervise or realm role.');
