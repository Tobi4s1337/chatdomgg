/**
 * Registration lines for the play HUD's slots (work/lanes/play/SEAMS.md, section B). Each lane that fills a slot
 * adds exactly one side-effect import of its own slot module here, for example `import '../forge/play-slot';`,
 * and nothing else. The HUD imports this file, so every provider has registered before the ledger first opens.
 */
import '../tavern/register';
import '../fishing/play-slot';
import '../fishing/kingdom-slot';
import '../raid-gate/play-slot';
import '../campfire/register';

export {};
