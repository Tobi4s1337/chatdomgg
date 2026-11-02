import { checkRepeatability, prepareRepeatability } from './repeatability';
import { certifyKit } from './certify';
const mode = process.argv[2];
if (mode === 'prepare') await prepareRepeatability();
else if (mode === 'check' && process.argv[3]) await checkRepeatability(process.argv[3]);
else if (mode === 'certify' && process.argv[3]) await certifyKit(Number(process.argv[3]), process.argv[4]);
else throw new Error('Use prepare, check <private-fixture-directory> or certify <kit-revision> [evidence-directory].');
