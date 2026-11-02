// What people say in tobi4s_'s chat, by mood. The crowd model draws from these without
// replacement, fills the placeholders and then types them out (caps, typos, timing).
//
// Placeholders:
//   {b}       @tobi4s_
//   {prev}    @ someone who spoke a moment ago
//   {forger}  @ the forger
//   {pk}      @PinkKittyRose
//   {topic}   the beat's topic words (lines with it are used only when the beat has a topic)
//   {e}       the beat's emote (emote waves)
// A line starting with `de:` is German and only goes to German speakers.
// A line starting with `sub:` is used only by tobi4s_'s subscribers (it has his channel emotes).

export const TRICKLE: readonly string[] = [
  'the water looks so much better than last week',
  'is that new fog?',
  'how many houses are there now',
  '{b} what are you building tonight',
  'lurking while i make dinner',
  'the little lanterns on the bridge <3',
  'chat is cozy tonight',
  'found my house, still by the mill SeemsGood',
  'my window is the one with the flower box',
  'just got home, what did i miss',
  "that's the old quarter right?",
  'i swear there is a new street every week',
  'brb tea',
  'the castle on the hill looks so good at night',
  'i can see my house from here LUL',
  'the roofs look so nice in this light',
  'cozy stream cozy chat',
  'wait since when are there fireflies',
  'this is my comfort stream fr',
  'the bakery chimney is my favourite thing in town',
  'ok i need a house by the water',
  '{b} is the forge open tonight?',
  '{b} did you fix the bridge thing from tuesday',
  'how long has the town been going now',
  'love the little boats',
  'the sky is so pretty right now',
  'my neighbour got a new roof?? fancy',
  'the mill wheel turning is so satisfying',
  'chat how did you all find this stream',
  'the music is so calm tonight',
  'is that a new tower by the gate',
  'whose house has the purple door',
  '{prev} yours is the one by the well right?',
  'had a long day, this is exactly what i needed',
  'the moon on the water <3',
  'every time i come back the town got bigger LUL',
  'what time is it there tobi',
  'the light in the windows makes it so warm',
  'tobi you should add cats. just saying',
  'my house still has the crooked chimney LUL',
  'quiet one tonight, i like it',
  'listening while i code, hi chat',
  'de: nabend zusammen',
  'de: gemütlich heute',
  'de: hab grad erst eingeschaltet, was baust du heute?',
  'de: die laternen sind so schön',
  'de: na, alles fit bei euch?',
  'de: feierabend endlich',
  'sub: tobi4s1GG',
];

export const GREET: readonly string[] = [
  'hi tobi!',
  'heyo',
  'evening everyone',
  'o7',
  'HeyGuys',
  'VoHiYo',
  'hi chat <3',
  'just made it HeyGuys',
  'evening {b}',
  'hii',
  'o/',
  'hello hello',
  'made tea, ready',
  'missed this stream',
  'hey {b} <3',
  'hello from the couch',
  'good evening kingdom',
  'hi all, long day',
  'heyyy',
  'evening chat VoHiYo',
  'back for another night',
  'hi everyone! KonCha',
  'yo',
  'de: moin',
  'de: nabend!',
  'de: servus chat',
  'de: hallo zusammen!',
  'de: moin moin',
  'de: n abend tobi',
];

/** A greeting aimed at one person: `{to}` is filled with @login. */
export const GREET_SOMEONE: readonly string[] = ['{to} heyy', '{to} o/', 'hi {to}!', '{to} evening!', 'welcome back {to}', '{to} hiii', 'de: {to} moin!', 'de: {to} servus'];
/** The greeted person's answer. */
export const GREET_BACK: readonly string[] = ['{to} o/', '{to} hey hey', 'hi {to} <3', '{to} heyo!', '{to} evening!', 'de: {to} moin moin', '{to} hiii VoHiYo'];

export const HYPE: readonly string[] = [
  'LETS GOOO',
  'PogChamp',
  'PogChamp PogChamp PogChamp',
  'NO WAY',
  'omg omg omg',
  'WWWW',
  'W',
  'HYPE',
  'KomodoHype KomodoHype',
  'yesss',
  'that was so good',
  'chat did you see that',
  'GG',
  'TwitchLit TwitchLit',
  'goosebumps',
  'AAAAA',
  "i'm screaming",
  'OMG',
  'SeemsGood SeemsGood',
  'the {topic}!!',
  'PogChamp {topic}',
  '{b} HOW',
  'this is insane',
  'clip that',
  'tobi you did it',
  'ok that was amazing',
  'PowerUpL KomodoHype PowerUpR',
  'CurseLit CurseLit',
  'LETS GO TOBI',
  'chills',
  'sub: tobi4s1GG tobi4s1GG',
  'sub: tobi4s1GG',
  'de: krass',
  'de: wie geil ist das denn',
];

export const AWE: readonly string[] = [
  'the lights omg',
  'wait is that my house',
  'every window is someone in chat??',
  'look at them all light up',
  'the windows <3',
  'it looks like a little town at christmas',
  'so cozy',
  'found mine!!',
  'mine just lit up',
  'wait which one is mine',
  'the old quarter is so pretty',
  '<3',
  "it's beautiful",
  'i love this',
  'TwitchLit',
  'SeemsGood',
  'the glow on the water',
  "it's alive",
  'ok this is magic',
  "i'm the one by the bakery",
  "they're all us??",
  'oh that is so pretty',
  'the whole street at once',
  'wait that one is me',
  'my light is on <3',
  'chat we did that',
  'the {topic} omg',
  'wow',
  '<3 <3 <3',
  'that warm light',
  'the little lanterns too',
  'i could watch this all night',
  'de: wie schön',
  'de: oh wow',
];

export const FORGE: readonly string[] = [
  'a DRAGON chimney',
  'SLEEPING DRAGON LUL',
  "it's smoking",
  'the smoke comes out of its nose 😭',
  "he's so cute",
  'i need one',
  'the hammer sound!!',
  'PogChamp',
  'LUL',
  'LUL LUL',
  '{forger} legend',
  '{forger} what have you done LUL',
  'it actually made it',
  "it's snoring i swear",
  'dragon house dragon house',
  'the runes tho',
  'it landed!!',
  'perfect fit',
  'the neighbours are staring LUL',
  'PogChamp PogChamp',
  'best house in town now',
  'next a dragon bakery',
  'look at its little tail',
  'it fits the roof so well',
  'the {topic} omg',
  "i'm forging a teapot later",
  '!forge a weathervane shaped like a cat',
  'tobi this is the best thing you ever made',
  'curled up on the roof 😭',
  'dont wake it',
  'de: der drache 😭',
];

export const RAID_WELCOME_LOCAL: readonly string[] = [
  'welcome raiders!! HeyGuys',
  'welcome in! <3',
  'o7 raiders',
  '{pk} thank you for the raid!!',
  'WELCOME',
  'twitchRaid welcome everyone',
  'hi raiders VoHiYo',
  'omg 48 PogChamp',
  'welcome welcome',
  'thanks for the raid {pk} <3',
  'biggest night ever LUL',
  'twitchRaid twitchRaid',
  'hi rose crew!',
  'welcome! the lanterns are for you',
  'they brought the whole caravan',
  'welcome to the town HeyGuys',
  'look at them coming through the gate',
  'de: willkommen!!',
];

/** What the mods say to raiders. */
export const RAID_WELCOME_MOD: readonly string[] = [
  'welcome raiders! say hi and the town makes room for you <3',
  'welcome in everyone! grab a lantern',
  '{pk} thank you so much for the raid! <3',
];

/** The raid message PinkKittyRose's raiders paste. */
export const RAID_MESSAGE = 'pkroseHeart PINKKITTYROSE RAID pkroseHeart';

export const RAID_RAIDER: readonly string[] = [
  'pkroseHype pkroseHype pkroseHype',
  'twitchRaid twitchRaid twitchRaid',
  'pinkkittyrose raid! pkroseHeart',
  'pkroseHello pkroseHello',
  'hi hi from the rose crew pkroseHeart',
  'omg it is so pretty in here',
  'what is this game??',
  'wait we get houses?',
  'hello tobi! pkroseHello',
  'raid raid raid pkroseHype',
  'pkroseHeart pkroseHeart',
  'the lanterns on the road!!',
  'is that us at the gate??',
  'hiii pkroseHello',
  'cozy town alert',
  'PINK RAID pkroseBOOM',
  'we brought snacks',
  'pkroseGG',
  'look at the banners',
  'what a cute little town',
  'hi {b}! pkroseHeart',
  'i want the house with the blue roof',
];

export const FAREWELL: readonly string[] = [
  'gn tobi <3',
  'good night chat',
  'thanks for the stream!',
  'o7',
  'see you next time HeyGuys',
  'that was a great one',
  'bye bye',
  'night everyone',
  'leaving my light on LUL',
  'gn! <3 <3',
  'o7 o7',
  'sleep well chat',
  'what a night',
  'the ride out was so good',
  'thanks {b}!',
  'see you thursday',
  'bye chat <3',
  'gn all, that was lovely',
  'de: gute nacht zusammen',
  'de: bis bald!',
  'de: schlaft gut',
];

export const FAREWELL_RAIDER: readonly string[] = ['thanks for having us pkroseHeart', 'gn town pkroseHeart', 'that was so fun pkroseHype', 'bye tobi! pkroseHello'];

/** What people who are not spamming the emote say during an emote wave. */
export const WAVE_FILLER: readonly string[] = ['LUL', '<3', 'omg', 'lol', 'cute', 'the spam LUL', 'chat LUL', 'SeemsGood'];

/** Short reactions that fit any mood. */
export const REACT: readonly string[] = ['omg', 'wow', 'yes', 'lol', 'real', 'cute', 'LUL', '<3', 'ooh', 'nice'];

/** Generic answers to an earlier statement (as a Twitch reply or an @mention), by mood. */
export const REPLY: Readonly<Record<'calm' | 'awe' | 'forge' | 'hype' | 'raid' | 'farewell', readonly string[]>> = {
  calm: ['same', 'fr', 'LUL', 'true', 'haha yes', 'agreed', 'yes!!', 'lol', 'right?', '<3'],
  awe: ['same!!', 'omg yes', '<3', "it's so pretty", 'right?? <3', 'i know', 'SeemsGood'],
  forge: ['LUL', 'need', 'the smoke 😭', 'ikr', 'legend', 'it really is', 'LUL LUL'],
  hype: ['FR', 'YES', 'LETS GO', 'LUL', 'right??', 'I KNOW'],
  raid: ['welcome!!', 'hi hi <3', 'welcome <3', 'HeyGuys', 'welcome in!'],
  farewell: ['gn!', 'night <3', 'o7', 'bye!', 'sleep well'],
};

/** Generic answers to a question nobody has a specific answer for. */
export const REPLY_QUESTION: readonly string[] = ['no idea LUL', 'good question', 'hmm', 'i think so?', 'ask tobi LUL'];

/** Specific answers to lines that invite one, keyed by the line as written above. */
export const ANSWERS: Readonly<Record<string, readonly string[]>> = {
  'how many houses are there now': ['like 60 i think', 'more every night LUL', 'one for everyone who chats'],
  'is that new fog?': ['yes he added it tuesday', 'looks so good right'],
  'how long has the town been going now': ['since the summer i think', 'over a year now?'],
  'the bakery chimney is my favourite thing in town': ['same, the smoke <3', 'the bakery is the best'],
  "that's the old quarter right?": ['yes, the first houses', 'yep, oldest street in town'],
  'whose house has the purple door': ['mine!! <3', 'not mine LUL'],
  'is that a new tower by the gate': ['new since last stream', 'yes!'],
  'wait since when are there fireflies': ['since last week i think', 'they come out at night'],
  'just got home, what did i miss': ['the town got bigger LUL', 'nothing much, cozy vibes', 'the bridge got lanterns'],
  'chat how did you all find this stream': ['a raid ages ago', 'random browsing, stayed for the town', 'a friend sent me'],
  'brb tea': ['enjoy', 'make me one too'],
  'had a long day, this is exactly what i needed': ['<3', 'same honestly'],
  'my house still has the crooked chimney LUL': ['it has character', 'never fix it'],
  'ok i need a house by the water': ['same', 'the shore ones are so nice'],
  'my neighbour got a new roof?? fancy': ['LUL', 'they forged it'],
  'wait is that my house': ['yes!! the one with the lit window', 'which street?'],
  'wait which one is mine': ['the one that just lit up LUL', 'look for your name'],
  'every window is someone in chat??': ['yes!! everyone who chats', 'yep, every light is one of us'],
  "they're all us??": ['yes LUL', 'every one of them'],
  'found mine!!': ['where??', 'same!!'],
  "i'm the one by the bakery": ['neighbours!!', 'fancy'],
  'wait that one is me': ['hi neighbour', 'LUL'],
  '!forge a weathervane shaped like a cat': ['LUL yes', 'need this'],
  'next a dragon bakery': ['YES', 'LUL'],
  'what is this game??': ["it's tobi's town, he builds it on stream", 'not a game, our town LUL'],
  'wait we get houses?': ['yes!! everyone gets one', 'say hi and you get one'],
  'is that us at the gate??': ['yes that is you LUL', 'that is you!!'],
  'i want the house with the blue roof': ['say hi and you get one LUL'],
  'we brought snacks': ['LUL', 'perfect'],
};

/** A second line from the same person a moment later. */
export const FOLLOW_UP: Readonly<Record<'calm' | 'excited' | 'warm', readonly string[]>> = {
  calm: ['lol', 'haha', 'LUL', '<3', 'anyway'],
  excited: ['omg', 'LUL', '😭', 'i love it', 'so good', 'chat', 'CHAT'],
  warm: ['<3', 'omg', 'HeyGuys', 'hi hi', 'so many people'],
};

/** Welcomes for someone chatting for the first time; `{to}` is filled with @login. */
export const FIRST_TIME_WELCOME: readonly string[] = ['welcome {to}!', 'omg hi {to} <3', '4 years LUL welcome {to}', 'welcome in!! HeyGuys', '{to} hiii', 'a lurker speaks PogChamp', 'welcome {to} <3'];

/** Messages people attach to a resub notice. */
export const SUB_MESSAGES: readonly string[] = ['still here <3', 'cozy nights', 'for the lanterns', 'love this town', 'my house says hi', 'tobi4s1GG', 'another month in the kingdom', 'best stream'];
