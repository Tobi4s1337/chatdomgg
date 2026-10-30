import { MaterialRegistrySchema, StyleIdSchema } from '@chatdom/shared';
export const MAT = { air:0, grass:1, earth:2, stone:3, limestone:4, timber:5, plaster:6, slate:7, terracotta:8, thatch:9, leaf:10, goldLeaf:11, brass:12, cloth:13, glass:14, darkStone:15, brick:16, moss:17, cream:18, bark:19, petal:20, blueFlower:21, waterbed:22, paving:23 } as const;
const colours = ['#000000','#667f52','#87664d','#aaa49b','#d0bda1','#77533e','#e2caa3','#41677d','#a85b47','#b89a5f','#4c7554','#bca05b','#b69155','#c36d55','#d0a66a','#65727d','#aa7861','#74835b','#e5d8b7','#665141','#d2968d','#8e9eb8','#5a7880','#b3a28a'];
const surfaces = ['air','grass','earth','stone','stone','wood','plaster','roof','roof','roof','leaf','leaf','metal','fabric','glass','stone','stone','grass','plaster','wood','leaf','leaf','stone','stone'] as const;
export const MATERIALS = MaterialRegistrySchema.parse({ version:1, revision:1, materials:Object.entries(MAT).map(([name,id]) => ({id,name,colour:colours[id],surface:surfaces[id],solid:id!==0,occludesFaces:id!==0,occludesAo:id!==0,blocksLight:id!==0})) });
export const STYLES = {
  hearth: {id:StyleIdSchema.parse('hearth'), name:'Hearth & heather',wall:MAT.plaster,roof:MAT.terracotta,trim:MAT.timber,stone:MAT.limestone},
  tide: {id:StyleIdSchema.parse('tide'),name:'Salt & slate',wall:MAT.cream,roof:MAT.slate,trim:MAT.timber,stone:MAT.stone},
  grove: {id:StyleIdSchema.parse('grove'),name:'Moss & honey',wall:MAT.plaster,roof:MAT.thatch,trim:MAT.bark,stone:MAT.darkStone},
} as const;
export type StyleKey = keyof typeof STYLES;
