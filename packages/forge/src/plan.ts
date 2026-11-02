import { HousePartPlanSchema, ForgeStyleKitSchema, type HousePartPlan } from '@chatdom/shared';
import { STYLES, type StyleKey } from '@chatdom/content/materials';
/** New work remains on one until every persisted scene/growth path resolves the saved revision. */
export const CURRENT_FORGE_STYLE_KIT_REVISION = 1;
export function forgeStyleKit(family:StyleKey,revision:number=CURRENT_FORGE_STYLE_KIT_REVISION){
  if(revision!==1&&revision!==2)throw new Error('Unregistered Forge style kit revision.');
  return ForgeStyleKitSchema.parse({version:1,id:`${family}-native`,styleId:STYLES[family].id,family,revision});
}
/** Finite local language for the labelled simulation. Not Codex and not a safety judge. */
export function planLocalForge(words:string):HousePartPlan {
  if(words.length>240)throw new Error('Keep the wish to one small house part.');
  const tokens=words.toLowerCase().replace(/^\s*!forge\s+/, '').replace(/[.,!?'-]/g,' ').trim().split(/\s+/);
  const allowed=new Set('a an the my for house home please make me shaped like of with little small lovely cosy cozy sleeping sleepy curled dragon chimney crescent moon lantern owl watchful weathervane weather vane roof on brass stone terracotta slate wooden'.split(' '));
  if(!tokens.length||tokens.some(t=>!allowed.has(t)))throw new Error('Try a sleeping dragon chimney, a moon lantern, or an owl weathervane.');
  const kinds=[tokens.includes('chimney'),tokens.includes('lantern'),tokens.includes('weathervane')||(tokens.includes('weather')&&tokens.includes('vane'))];
  if(kinds.filter(Boolean).length!==1)throw new Error('Wish for one house part at a time.');
  if(kinds[0]&&tokens.includes('dragon'))return HousePartPlanSchema.parse({version:1,kind:'chimney',motif:'sleeping-dragon'});
  if(kinds[1]&&tokens.includes('moon'))return HousePartPlanSchema.parse({version:1,kind:'lantern',motif:'crescent-moon'});
  if(kinds[2]&&tokens.includes('owl'))return HousePartPlanSchema.parse({version:1,kind:'weathervane',motif:'watchful-owl'});
  throw new Error('The local grammar needs a dragon, moon, or owl to shape.');
}
export function forgeTitle(plan:HousePartPlan){return {chimney:'The dreaming dragon',lantern:'A little borrowed moon',weathervane:'The watcher of the winds'}[plan.kind];}
export function forgeWords(plan:HousePartPlan){return {chimney:'a chimney shaped like a sleeping dragon',lantern:'a lantern shaped like a crescent moon',weathervane:'an owl weathervane'}[plan.kind];}
