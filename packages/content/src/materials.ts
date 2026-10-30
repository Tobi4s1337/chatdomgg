import { MaterialRegistrySchema, StyleIdSchema } from '@chatdom/shared';
export const MAT = { air:0, grass:1, earth:2, stone:3, limestone:4, timber:5, plaster:6, slate:7, terracotta:8, thatch:9, leaf:10, goldLeaf:11, brass:12, cloth:13, glass:14, darkStone:15, brick:16, moss:17, cream:18, bark:19, petal:20, blueFlower:21, waterbed:22, paving:23, skin1:24,skin2:25,skin3:26,skin4:27,skin5:28,skin6:29,skin7:30,skin8:31,skinFeyAsh:32,skinFeyMoss:33,hairBlack:34,hairBrown:35,hairChestnut:36,hairGold:37,hairCopper:38,hairSilver:39,fabricRed:40,fabricOrange:41,fabricGold:42,fabricGreen:43,fabricBlue:44,fabricViolet:45, fabricMutedRed:46,fabricMutedOrange:47,fabricMutedGold:48,fabricMutedGreen:49,fabricMutedBlue:50,fabricMutedViolet:51 } as const;
const colours = ['#000000','#667f52','#87664d','#aaa49b','#d0bda1','#77533e','#e2caa3','#41677d','#a85b47','#b89a5f','#4c7554','#bca05b','#b69155','#c36d55','#d0a66a','#65727d','#aa7861','#74835b','#e5d8b7','#665141','#d2968d','#8e9eb8','#5a7880','#b3a28a','#f2c9a7','#dfad8a','#cb956e','#af7754','#8f5c40','#70442f','#513126','#35231e','#b5a0c2','#8ba99b','#30241f','#6b4833','#b27b45','#d5bf7d','#8f3f2d','#d9d6cc','#a94744','#c78746','#d8bd68','#58816c','#557f9e','#8b6f9e','#765b58','#7d6b57','#897e62','#5c6e62','#596d7c','#6e6378'];
const surfaces = ['air','grass','earth','stone','stone','wood','plaster','roof','roof','roof','leaf','leaf','metal','fabric','glass','stone','stone','grass','plaster','wood','leaf','leaf','stone','stone','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric','fabric'] as const;
export const MATERIALS = MaterialRegistrySchema.parse({ version:1, revision:2, materials:Object.entries(MAT).map(([name,id]) => ({id,name,colour:colours[id],surface:surfaces[id],solid:id!==0,occludesFaces:id!==0,occludesAo:id!==0,blocksLight:id!==0})) });
export const STYLES = {
  hearth: {id:StyleIdSchema.parse('hearth'), name:'Hearth & heather',wall:MAT.plaster,roof:MAT.terracotta,trim:MAT.timber,stone:MAT.limestone},
  tide: {id:StyleIdSchema.parse('tide'),name:'Salt & slate',wall:MAT.cream,roof:MAT.slate,trim:MAT.timber,stone:MAT.stone},
  grove: {id:StyleIdSchema.parse('grove'),name:'Moss & honey',wall:MAT.plaster,roof:MAT.thatch,trim:MAT.bark,stone:MAT.darkStone},
} as const;
export type StyleKey = keyof typeof STYLES;

/** Semantic avatar swatches. Geometry factories use IDs, never skin-derived identity. */
export const AVATAR_PALETTE = {
  skin:[MAT.skin1,MAT.skin2,MAT.skin3,MAT.skin4,MAT.skin5,MAT.skin6,MAT.skin7,MAT.skin8,MAT.skinFeyAsh,MAT.skinFeyMoss],
  hair:[MAT.hairBlack,MAT.hairBrown,MAT.hairChestnut,MAT.hairGold,MAT.hairCopper,MAT.hairSilver],
  fabric:[MAT.fabricRed,MAT.fabricOrange,MAT.fabricGold,MAT.fabricGreen,MAT.fabricBlue,MAT.fabricViolet],
  rainbow:[MAT.fabricRed,MAT.fabricOrange,MAT.fabricGold,MAT.fabricGreen,MAT.fabricBlue,MAT.fabricViolet],
  fabricLapsed:[MAT.fabricMutedRed,MAT.fabricMutedOrange,MAT.fabricMutedGold,MAT.fabricMutedGreen,MAT.fabricMutedBlue,MAT.fabricMutedViolet],
} as const;
