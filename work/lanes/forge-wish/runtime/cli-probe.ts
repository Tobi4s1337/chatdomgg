import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { resolveCodexExecutable } from '../../../../apps/codex/src/providers/codex-cli';

/** Version only, no login read, model request or raw child output. Run inside the actual served process. */
export async function probeCliLaunch(cwd: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.CODEX_HOME = cwd;
  const directories = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const executableExists = await access(join(dirname(process.execPath), 'codex')).then(() => true, () => false);
  const directoryExists = await access(cwd).then(() => true, () => false);
  const launch = await resolveCodexExecutable(env.PATH);
  if (launch.source === 'missing') return { started: false, errno: 'ENOENT', pathPresent: !!env.PATH,
    pathDirectories: directories.length, nodeBinOnPath: directories.includes(dirname(process.execPath)),
    adjacentCliAvailable: executableExists, directoryExists, resolution: launch.source };
  if (launch.path !== undefined) env.PATH = launch.path;
  const result = await new Promise<{ started: boolean; errno?: string }>(resolve => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(launch.command, ['--version'], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { resolve({ started: false, errno: 'UNKNOWN' }); return; }
    const deadline = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch { /* already closed */ } }
    }, 3000);
    let finished = false;
    const finish = (result: { started: boolean; errno?: string }) => {
      if (finished) return; finished = true; clearTimeout(deadline); resolve(result);
    };
    child.stdout?.resume(); child.stderr?.resume(); child.stdin?.on('error', () => {}); child.stdin?.end();
    child.once('error', error => {
      const code = 'code' in error ? error.code : '';
      finish({ started: false, errno: typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code) ? code : 'UNKNOWN' });
    });
    child.once('close', code => finish({ started: code === 0 }));
  });
  return { ...result, pathPresent: !!env.PATH, pathDirectories: directories.length,
    nodeBinOnPath: directories.includes(dirname(process.execPath)), adjacentCliAvailable: executableExists, directoryExists, resolution: launch.source };
}
