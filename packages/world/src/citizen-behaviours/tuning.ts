/**
 * Authored presentation tuning. These bands shape how a street feels; they are not
 * rewards, scores or personality claims, and they are not product settings.
 * Every choice inside a band is made once, at a state transition, from a stable
 * kingdom/epoch/slot seed. See README.md for why each value is what it is.
 */
export const BEHAVIOUR_TUNING = {
  /** Fixed policy cadence in kingdom time. Steps sit on an absolute grid of this size. */
  stepMs: 100,
  /** A gap larger than this is a clock jump: transient looks and gestures are dropped, never replayed. */
  maxGapMs: 1_000,
  /** At most this many fixed steps are caught up in one caller frame before the clock jumps. */
  maxCatchUpSteps: 10,

  neighbours: {
    /** Grid cell edge in metres. Equal to the keep range, so a 3×3 query is exhaustive. */
    cellMetres: 7.5,
    /** Closest people considered per citizen per step, after stable distance/slot ordering. */
    maxPerCitizen: 6,
  },

  greeting: {
    /** Closer than this a greeting would read as pursuit or crowding. */
    minMetres: 1.6,
    /** A passing neighbour becomes noticeable inside this range. Doorsteps sit ~6.2–6.7 m from the lane centre. */
    noticeMetres: 7,
    /** An existing contact survives to this range, so a person on the boundary does not flicker in and out. */
    keepMetres: 7.5,
    /** Inside this range a nod reads; beyond it a wave is the gesture that carries across a lane. */
    nodMetres: 4.5,
    /** Probability of a wave across the lane, and of a wave at nodding range. Chosen once per contact. */
    farWaveChance: .45,
    nearWaveChance: .12,
    /** Chance that a fresh contact becomes a greeting at all. Chosen once per contact. */
    chance: .72,
    /** A contact stays open for a decision for this long after the pair first came within range. */
    decisionWindowMs: 4_000,
    /** Both people must have been in the street this long; nobody greets the instant they appear. */
    presentBeforeMs: 2_500,
    /** A citizen must have stood still this long before noticing anyone. */
    settleBeforeMs: 1_200,
    /** Half field of view, radians from a settled greeter's body heading. */
    fieldOfView: 1.3,
    /** A walker notices someone ahead of them, inside this half angle, and never slows to do it. */
    walkingFieldOfView: 1,
    /** A walking greeter waits until the other person is this close; a settled one notices across a lane. */
    walkingMetres: 5,
    /** Walkers greet only at cruising pace, not while starting off or stopping at a door. */
    walkingMinSpeed: .6,
    /** Head turn ahead of the gesture: the head moves before the hand. */
    lookLeadMs: [300, 480] as const,
    /** Head holds on the neighbour after the gesture. */
    holdMs: [250, 650] as const,
    /** Head eases back to rest. */
    settleMs: [420, 640] as const,
    /** The same two people do not greet each other again inside this band. */
    pairCooldownMs: [90_000, 120_000] as const,
    /** One person's rest between their own greetings. */
    restAfterMs: [8_000, 16_000] as const,
  },

  glance: {
    /** The recipient's glance starts this long after the greeter's gesture begins. */
    delayMs: [80, 350] as const,
    inMs: 260,
    /** Someone is visible to a recipient within the neck limit plus this margin; nobody greets a back. */
    beyondNeck: .35,
    outMs: 450,
  },

  look: {
    /** Head yaw limits, radians relative to the body. Walking heads turn less. */
    standingLimit: 1.05,
    walkingLimit: .8,
    /** Eased return to rest when a look is interrupted by removal or departure. */
    releaseMs: 420,
  },

  /**
   * The current renderer's gesture clocks: nod pitch is `.14 + .12 sin(6t)` and the
   * wave arm is `1.75 + .22 sin(8t)`. The phase starts a nod at its shallowest pitch
   * and a full cycle returns there, so the head enters and leaves one dip near rest.
   * A wave is one and a half sways. These follow the renderer; they are not a new pose protocol.
   */
  gestures: {
    nod: { phaseSeconds: -Math.PI / 12, durationMs: Math.round(2 * Math.PI / 6 * 1000) },
    wave: { phaseSeconds: 0, durationMs: Math.round(3 * Math.PI / 8 * 1000) },
  },
} as const;
