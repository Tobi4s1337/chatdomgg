import { runPrivateForgeProof } from './proof';
const mode = process.argv[2];
if (mode !== 'prepare' && mode !== 'pilot' && mode !== 'twenty') throw new Error('The private Forge proof requires prepare, pilot or twenty.');
await runPrivateForgeProof(mode, Number(process.argv[3]));
