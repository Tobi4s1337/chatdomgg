import {
  BEARD_STYLE_IDS, BOTTOM_STYLE_IDS, EARRING_STYLE_IDS, EAR_STYLE_IDS, FACE_PAINT_STYLE_IDS, GLASSES_STYLE_IDS, HAIR_STYLE_IDS, HAT_STYLE_IDS,
  HELD_STYLE_IDS, MOUSTACHE_STYLE_IDS, NECKWEAR_STYLE_IDS, OUTER_STYLE_IDS, SHOE_STYLE_IDS, TOP_STYLE_IDS,
} from './recipe';

/*
 * Piece cards: every wearable piece's name and one line of its story, in the kingdom's voice, for the builder's
 * item cards. Every piece belongs to a tier: `base` is the free set everyone has from the start, `fun` the funny
 * one (silly hats, held toys, face paint, a few daft extras). Both are free to wear; nothing here is bought.
 * Earned pieces keep their own cards in `earned.ts`. `isNew` marks the pieces of the second wardrobe.
 */

export type PieceKind =
  | 'hair' | 'beard' | 'moustache' | 'hat' | 'glasses' | 'earrings' | 'flower' | 'ears' | 'face-paint' | 'held'
  | 'top' | 'outer' | 'bottom' | 'neckwear' | 'shoes';
export type PieceTier = 'base' | 'fun';

export interface PieceCard {
  readonly kind: PieceKind;
  readonly id: string;
  readonly name: string;
  readonly story: string;
  readonly tier: PieceTier;
  readonly isNew: boolean;
}

export const PIECE_KINDS: readonly PieceKind[] = [
  'hair', 'beard', 'moustache', 'hat', 'glasses', 'earrings', 'flower', 'ears', 'face-paint', 'held', 'top', 'outer', 'bottom', 'neckwear', 'shoes',
];

/** The ids each kind offers, as the recipe names them. The flower has one piece, `flower`. */
export const PIECE_IDS: Readonly<Record<PieceKind, readonly string[]>> = {
  hair: HAIR_STYLE_IDS, beard: BEARD_STYLE_IDS, moustache: MOUSTACHE_STYLE_IDS, hat: HAT_STYLE_IDS, glasses: GLASSES_STYLE_IDS,
  earrings: EARRING_STYLE_IDS, flower: ['flower'], ears: EAR_STYLE_IDS, 'face-paint': FACE_PAINT_STYLE_IDS, held: HELD_STYLE_IDS,
  top: TOP_STYLE_IDS, outer: OUTER_STYLE_IDS, bottom: BOTTOM_STYLE_IDS, neckwear: NECKWEAR_STYLE_IDS, shoes: SHOE_STYLE_IDS,
};

/** [id, name, story, tier]; the tier is `base` unless given. */
type Line = readonly [id: string, name: string, story: string, tier?: PieceTier];

const FIRST: Readonly<Record<PieceKind, readonly Line[]>> = {
  hair: [
    ['short-crop', 'Short crop', 'Cut close at the sides by the barber who hums the same three notes every time.'],
    ['side-part', 'Side part', 'Combed with care every morning, and parted on the side the wind prefers.'],
    ['quiff', 'Quiff', 'Swept up at the front and held there by determination and a dab of beeswax.'],
    ['slicked', 'Slicked back', 'Smoothed back with a wet comb, for when you want to look like you have news.'],
    ['spiky', 'Spiky', 'Every point stands up on its own. Nobody asked them to.'],
    ['side-shave', 'Side shave', 'Shorn close on one side, so the other side has room to make a statement.'],
    ['mohawk', 'Crest', 'A tall crest down the middle, like a proud little hill with a path either side.'],
    ['wild-tuft', 'Wild tuft', 'It was tidy once, for about a minute, on a Tuesday.'],
    ['curls', 'Curls', 'Springy curls that bounce a beat behind you when you run.'],
    ['afro', 'Afro', 'Round, full and soft as a cloud, and it fills a doorway with style.'],
    ['locs', 'Locs', 'Long locs, grown with patience, that sway when you laugh.'],
    ['bob', 'Bob', 'A neat bob that swings at the jaw and always lands just right.'],
    ['long-waves', 'Long waves', 'Loose waves past the shoulders, the kind the river wind loves to play with.'],
    ['braids', 'Braids', 'Two plaits woven tight in the morning, still tidy by the evening bell.'],
    ['ponytail', 'Ponytail', 'Tied back and out of the way, ready for whatever the day throws.'],
    ['pigtails', 'Pigtails', 'Two bunches that bob at every step, as if they were having their own conversation.'],
    ['buns', 'Buns', 'Two buns pinned high: one for thinking, one spare.'],
    ['top-knot', 'Top knot', 'Everything gathered into one neat knot on the crown, like a tidy thought.'],
    ['bald', 'Bald', 'Nothing to comb, nothing to tangle, and the sun says hello first.'],
  ],
  beard: [
    ['full', 'Full beard', 'A full, warm beard that has kept a whole winter of chins cosy.'],
    ['chinstrap', 'Chinstrap', 'A neat line along the jaw, drawn by a careful hand and a steady razor.'],
    ['goatee', 'Goatee', 'A small point on the chin, for stroking while you think of something clever.'],
    ['stubble', 'Stubble', 'Three days of not bothering, worn with confidence.'],
  ],
  moustache: [
    ['walrus', 'Walrus', 'Big, bushy and drooping. It hides a smile, and now and then some soup.'],
    ['handlebar', 'Handlebar', 'Waxed every morning so the tips curl up toward the stars.'],
    ['horseshoe', 'Horseshoe', 'Down past the chin on both sides, as if it had gone looking for a beard.'],
  ],
  hat: [
    ['cap', 'Cap', 'A six-panel cap with a bill to keep the sun out of your eyes on long afternoons.'],
    ['cap-backwards', 'Backwards cap', 'The same cap turned round, which everyone agrees is a different mood entirely.'],
    ['beanie', 'Beanie', 'A snug knitted beanie with a pompom that bounces every time you nod.'],
    ['straw-hat', 'Straw hat', 'Woven from the summer’s last wheat. It smells faintly of hay and sunshine.'],
    ['pointed-hat', 'Pointed hat', 'A tall felt cone that flops at the tip. It has never cast a spell, but it lives in hope.'],
  ],
  glasses: [
    ['round', 'Round glasses', 'Thin wire rims, perfectly round, for small print and big ideas.'],
    ['square', 'Square glasses', 'Heavy frames with a sturdy brow, for looking thoughtful even when you are not.'],
    ['goggles', 'Goggles', 'Thick lenses on a strap round the head, from the workshop where the sparks fly.'],
  ],
  earrings: [
    ['stud', 'Studs', 'A small bright stud in each ear, quiet and always there.'],
    ['hoop', 'Hoops', 'Round hoops that catch the lantern light when you turn your head.'],
    ['drop', 'Drops', 'Little drops that swing gently as you walk.'],
  ],
  flower: [
    ['flower', 'Flower', 'A fresh flower tucked over the ear, or into the band of a hat.'],
  ],
  ears: [],
  'face-paint': [],
  held: [],
  top: [
    ['tee', 'Tee', 'A soft cotton tee, the shirt that goes with everything and everyone.'],
    ['tank', 'Tank top', 'Bare-shouldered and cool, for summer afternoons and hard work.'],
    ['shirt', 'Shirt', 'A collared shirt with the sleeves rolled up, ready to help with something.'],
    ['hoodie', 'Hoodie', 'A roomy hoodie with a pocket for your hands and a hood for the drizzle.'],
    ['sweater', 'Sweater', 'A thick knitted sweater, warm as a hearth and only slightly itchy.'],
    ['robe', 'Robe', 'A long flowing robe with a sash, for scholars, wizards and anyone in slippers.'],
  ],
  outer: [
    ['jacket', 'Jacket', 'A sturdy jacket with a turned-up collar, worn open over whatever is underneath.'],
    ['vest', 'Vest', 'An open vest over your sleeves, smart enough for market day.'],
    ['overshirt', 'Overshirt', 'A loose short-sleeved shirt worn open over another, for a breezy look.'],
    ['coat', 'Coat', 'A long coat that swings at the knees, for windy streets and dramatic exits.'],
  ],
  bottom: [
    ['trousers', 'Trousers', 'Good, honest trousers with room in the knees.'],
    ['shorts', 'Shorts', 'Shorts for warm days and scraped knees.'],
    ['skirt', 'Skirt', 'A pleated skirt that swings out when you spin.'],
    ['overalls', 'Overalls', 'Dungarees with a bib pocket and two brass buttons, made for work and play.'],
  ],
  neckwear: [
    ['scarf', 'Scarf', 'A striped knitted scarf, wound once and left to hang.'],
    ['tie', 'Tie', 'A striped tie for when there is a meeting at the guild hall.'],
    ['bowtie', 'Bow tie', 'A neat bow tie: a little dashing, a little silly, completely sincere.'],
    ['bandana', 'Bandana', 'A spotted kerchief knotted at the back, for dusty roads and sunny days.'],
  ],
  shoes: [
    ['sneakers', 'Sneakers', 'Rubber soles for running, jumping and sneaking up on friends.'],
    ['boots', 'Boots', 'Sturdy leather boots that have walked a great many muddy lanes.'],
    ['shoes', 'Shoes', 'Polished leather shoes for everyday walking and the occasional dance.'],
  ],
};

/** The second wardrobe (H03): the pieces added after the character art was accepted. */
const SECOND: Readonly<Record<PieceKind, readonly Line[]>> = {
  hair: [],
  beard: [],
  moustache: [],
  hat: [
    ['beret', 'Beret', 'A soft felt beret, worn tipped to one side by people who notice the light.'],
    ['bucket-hat', 'Bucket hat', 'A floppy brim all the way round, for fishing, gardening and not being recognised.'],
    ['top-hat', 'Top hat', 'A tall, proud hat for occasions, and for people who make every day one.'],
    ['flat-cap', 'Flat cap', 'Tweed, low and comfortable. It has opinions about the weather and keeps them to itself.'],
    ['flower-crown', 'Flower crown', 'Woven from whatever was blooming by the road that morning, so no two are alike.'],
    ['earflap-hat', 'Earflap hat', 'Fleece-lined flaps over the ears, for frosty mornings and anyone who feels the cold.'],
    ['frog-hat', 'Frog hat', 'Knitted by someone who had never seen a frog, from a very good description.', 'fun'],
    ['teapot-hat', 'Teapot hat', 'A real teapot, retired from service. It still feels the urge to pour when you bow.', 'fun'],
    ['party-cone', 'Party cone', 'A striped paper cone with a pompom. Any day you wear it becomes a party.', 'fun'],
    ['fish-hat', 'Fish hat', 'A plush fish napping on your head. Nobody knows how it got up there.', 'fun'],
    ['chef-toque', 'Chef’s hat', 'A tall starched toque. While you wear it, you may taste everything.', 'fun'],
    ['propeller-cap', 'Propeller cap', 'The propeller spins in any breeze. It has not lifted anyone yet, but it keeps trying.', 'fun'],
    ['antler-band', 'Antler band', 'Soft felt antlers on a headband, for festivals, frosty nights and general merriment.', 'fun'],
    ['nightcap', 'Nightcap', 'A long striped nightcap whose pompom flops down your back. Yawning is optional.', 'fun'],
    ['toadstool-cap', 'Toadstool cap', 'A spotted toadstool worn as a hat. The fey swear it is the height of fashion.', 'fun'],
    ['bee-antennae', 'Bee antennae', 'Two bobbling antennae on a headband. You may feel a sudden urge to visit flowers.', 'fun'],
  ],
  glasses: [
    ['shades', 'Shades', 'Dark lenses for bright days, and for walking into the tavern as if you owned it.'],
    ['half-moon', 'Half-moon glasses', 'Low on the nose, for peering over at whoever just said something interesting.'],
    ['heart', 'Heart glasses', 'Heart-shaped frames that make everything you look at a little more lovable.', 'fun'],
    ['star', 'Star glasses', 'Star-shaped frames for people who are, frankly, the main event.', 'fun'],
    ['monocle', 'Monocle', 'One lens on a little chain. Raise an eyebrow and it does the rest.', 'fun'],
  ],
  earrings: [
    ['crescent', 'Crescent moons', 'A sliver of moon at each ear, for night owls and stargazers.'],
    ['pearl', 'Pearls', 'A round pearl on a short drop, from the river and not the sea, or so they say.'],
    ['tassel', 'Tassels', 'Bright little tassels that flick about when you laugh.'],
    ['cherries', 'Cherries', 'A pair of cherries at each ear. Do not eat them, however tempting.', 'fun'],
  ],
  flower: [],
  ears: [
    ['pointed', 'Pointed ears', 'Fey ears with a neat point, the kind that hear the kettle before it whistles.'],
    ['long-fey', 'Long fey ears', 'Long sweeping ears from the old woods, said to hear a promise made three streets away.'],
    ['tufted', 'Tufted ears', 'Pointed ears with a little tuft at the tip that twitches when you are curious.'],
    ['droopy', 'Droopy ears', 'Long ears that droop at the tips, soft and sleepy as a lazy afternoon.'],
    ['leaf', 'Leaf ears', 'Broad fey ears shaped like a leaf. In autumn they rustle, very faintly.'],
    ['petite', 'Petite points', 'Just a hint of a point: a fey touch most people only notice the second time.'],
  ],
  'face-paint': [
    ['cheek-stripes', 'Cheek stripes', 'Bold stripes for cheering at the games, a little smudged by the end of the night.', 'fun'],
    ['cheek-star', 'Cheek star', 'A bright star painted at the fair. It lasts longer than the toffee apple.', 'fun'],
    ['paint-dots', 'Paint dots', 'Dots of paint across the cheeks, like freckles that went to a festival.', 'fun'],
    ['heart', 'Painted heart', 'A little heart on the cheek, painted by a friend who held the brush very seriously.', 'fun'],
    ['daisy', 'Painted daisy', 'A daisy on the cheek with a sunny middle that never wilts.', 'fun'],
    ['mask-band', 'Mask band', 'A painted band across the eyes, festival style. Your identity remains a mystery to no one.', 'fun'],
  ],
  held: [
    ['rubber-duck', 'Rubber duck', 'It squeaks when squeezed and has strong opinions about bath time.', 'fun'],
    ['paper-lantern', 'Paper lantern', 'A little paper lantern for the walk home when the evening turns blue.', 'fun'],
    ['balloon', 'Balloon', 'A balloon on a string from the fair. Hold on tight: it has places to be.', 'fun'],
    ['teddy', 'Teddy', 'A well-loved teddy with one ear slightly more chewed than the other.', 'fun'],
    ['wooden-sword', 'Wooden sword', 'Whittled from a fallen branch. It has defeated many hedges and one very surprised pumpkin.', 'fun'],
    ['bouquet', 'Bouquet', 'Flowers wrapped in paper, for someone special, or for no reason at all.', 'fun'],
    ['cider-mug', 'Mug of cider', 'A wooden mug of warm cider from the tavern, still foaming at the top.', 'fun'],
    ['baguette', 'Baguette', 'A very long loaf from the baker’s, mostly for eating and partly for pointing.', 'fun'],
    ['paper-windmill', 'Paper windmill', 'A paper pinwheel on a stick that spins whenever you remember to run.', 'fun'],
    ['frog-plush', 'Frog plush', 'A soft green frog with a wide, contented face. It has never once complained.', 'fun'],
    ['cupcake', 'Cupcake', 'Pink frosting, a cherry on top, and absolutely no plans to share.', 'fun'],
    ['ice-cream', 'Ice cream', 'Two scoops in a waffle cone, starting to drip, so best eaten soon.', 'fun'],
    ['storybook', 'Storybook', 'A small book of the kingdom’s tales, with a gold star on the cover and a folded page you love.', 'fun'],
    ['star-wand', 'Star wand', 'A wand with a star on top. It grants no wishes, but you do stand up straighter.', 'fun'],
  ],
  top: [
    ['turtleneck', 'Turtleneck', 'A knitted roll neck that hugs the chin, for chilly mornings and serious poetry.'],
    ['tunic', 'Tunic', 'A belted tunic that falls past the hips, as worn by travellers since the first road.'],
    ['sailor', 'Sailor top', 'A square collar that flaps in the harbour breeze, with a knot tied at the front.'],
    ['raglan', 'Raglan tee', 'A tee with sleeves in a second colour, for ball games in the square.'],
  ],
  outer: [
    ['cardigan', 'Cardigan', 'A soft knitted cardigan with brass buttons that nobody has ever done up.'],
    ['cloak', 'Short cloak', 'A short cloak round the shoulders with a brass clasp, for travellers and the travel-minded.'],
    ['poncho', 'Poncho', 'A warm woven poncho that keeps off wind and drizzle, its fringe swaying as you go.'],
    ['puffer', 'Puffer jacket', 'Quilted and puffy, like wearing a very warm cloud.'],
    ['apron', 'Apron', 'A sturdy apron with a pocket, for baking, gardening, smithing, or all three.'],
  ],
  bottom: [
    ['rolled-trousers', 'Rolled trousers', 'Rolled up at the ankle, for paddling in the river without a second thought.'],
    ['cargo-trousers', 'Cargo trousers', 'Pockets on the legs for acorns, string, a snack and one interesting stone.'],
    ['shortalls', 'Shortalls', 'Overalls with short legs, for summer chores and climbing trees.'],
  ],
  neckwear: [
    ['pendant', 'Pendant', 'A stone on a cord, found by the river and kept for luck.'],
    ['beads', 'Bead necklace', 'Chunky painted beads, strung one evening by the fire.'],
    ['cowl', 'Knitted cowl', 'A thick knitted loop round the neck, like a scarf that never needs tying.'],
    ['ruff', 'Ruff', 'A frilled collar fit for a portrait. It holds your chin up whether you like it or not.', 'fun'],
  ],
  shoes: [
    ['clogs', 'Clogs', 'Carved wooden clogs that clatter happily on the cobbles.'],
    ['sandals', 'Sandals', 'Strappy sandals for warm stones and sandy riverbanks.'],
    ['wellies', 'Wellies', 'Bright rubber boots for puddles, which are there to be jumped in.'],
    ['slippers', 'Slippers', 'Fluffy slippers with pompoms, for people who never quite left the house.', 'fun'],
    ['curly-toes', 'Curly-toed shoes', 'Fey shoes whose toes curl up at the tip, made for dancing in mushroom rings.', 'fun'],
  ],
};

const card = (kind: PieceKind, isNew: boolean) => ([id, name, story, tier = 'base']: Line): PieceCard => ({ kind, id, name, story, tier, isNew });

/** Every piece's card, old and new, kind by kind in the recipe's order. */
export const PIECE_CARDS: readonly PieceCard[] = PIECE_KINDS.flatMap(kind => {
  const cards = [...FIRST[kind].map(card(kind, false)), ...SECOND[kind].map(card(kind, true))];
  return PIECE_IDS[kind].map(id => cards.find(c => c.id === id)).filter((c): c is PieceCard => c !== undefined);
});

const BY_KEY = new Map(PIECE_CARDS.map(c => [`${c.kind}:${c.id}`, c]));

/** The card of one piece, or undefined for an id the kind does not have. */
export function pieceCard(kind: PieceKind, id: string): PieceCard | undefined {
  return BY_KEY.get(`${kind}:${id}`);
}
