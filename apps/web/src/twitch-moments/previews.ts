import type { TwitchActionArgs } from './contracts';

/**
 * The exact public consequence of one press, shown before it. Text that will appear on Twitch is quoted
 * verbatim; private targets (a person ID) are never rendered, only the fact that one is chosen.
 */
export function describeAction(args: TwitchActionArgs): { title: string; lines: string[] } {
  switch (args.kind) {
    case 'poll-create':
      return { title: 'Open a decree poll on Twitch', lines: [`“${args.title}”`, ...args.choices.map((c, i) => `${i + 1}. ${c}`),
        `Open for ${duration(args.durationSeconds)}. Channel Points cannot buy extra votes.`] };
    case 'poll-end':
      return { title: args.outcome === 'terminate' ? 'End the poll now and show its result' : 'Close the poll and hide it', lines: [] };
    case 'prediction-create':
      return { title: 'Open a prediction on Twitch', lines: [`“${args.title}”`, ...args.outcomes.map((o, i) => `${i + 1}. ${o}`),
        `Predictions lock after ${duration(args.windowSeconds)}.`] };
    case 'prediction-settle':
      return { title: args.outcome === 'lock' ? 'Lock the prediction' : args.outcome === 'cancel' ? 'Cancel the prediction; Twitch refunds every point'
        : 'Resolve the prediction with the match result', lines: [] };
    case 'vip-add':
      return { title: 'Give the chosen citizen VIP on Twitch', lines: ['Twitch decides whether a VIP slot is free.'] };
    case 'announcement':
      return { title: 'Post an announcement in chat', lines: [`“${args.message}”`, `Colour: ${args.colour}`] };
    case 'shoutout':
      return { title: 'Send a Twitch shoutout', lines: ['Twitch applies its own shoutout cooldowns.'] };
    case 'reward-pack':
      return { title: args.enabled ? 'Turn on the Chatdom rewards' : 'Turn off the Chatdom rewards', lines: [] };
    case 'marker':
      return { title: 'Place a stream marker', lines: args.description ? [`“${args.description}”`] : ['No description'] };
    case 'walker-chat':
      return { title: 'Say this in chat as yourself', lines: [`“${args.message}”`] };
  }
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return `${minutes} minute${minutes === 1 ? '' : 's'}${rest ? ` ${rest} seconds` : ''}`;
}
