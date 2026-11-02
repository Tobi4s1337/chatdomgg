import { checkRepeatability, prepareRepeatability } from './repeatability';
const mode = process.argv[2];
if (mode === 'prepare') await prepareRepeatability();
else if (mode === 'check' && process.argv[3]) await checkRepeatability(process.argv[3]);
else throw new Error('Use prepare or check with an owned private fixture directory.');
