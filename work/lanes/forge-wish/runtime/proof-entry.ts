import { runPrivateForgeProof } from './proof';
const mode = process.argv[2];
if (mode !== 'prepare' && mode !== 'pilot' && mode !== 'twenty' && mode !== 'stress') throw new Error('The private Forge proof requires prepare, pilot, twenty or stress.');
await runPrivateForgeProof(mode, Number(process.argv[3]));
