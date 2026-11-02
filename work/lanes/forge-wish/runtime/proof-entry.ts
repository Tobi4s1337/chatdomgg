import { runPrivateForgeProof } from './proof';
const mode = process.argv[2];
if (mode !== 'prepare' && mode !== 'pilot') throw new Error('The private Forge proof requires prepare or pilot.');
await runPrivateForgeProof(mode, Number(process.argv[3]));
