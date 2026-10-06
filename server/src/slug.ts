import { randomId } from './crypto.js';

const adjectives = [
  'amber', 'brisk', 'calm', 'coastal', 'deep', 'dusky', 'fair', 'gentle', 'harbor', 'hidden',
  'iron', 'keen', 'lunar', 'misty', 'north', 'quiet', 'rapid', 'salty', 'silver', 'steady',
  'swift', 'tidal', 'true', 'wild', 'windy',
];
const nouns = [
  'anchor', 'beacon', 'buoy', 'cove', 'current', 'falcon', 'ferry', 'gull', 'harbor', 'heron',
  'inlet', 'keel', 'lantern', 'mast', 'otter', 'pier', 'reef', 'rudder', 'schooner', 'shoal',
  'sloop', 'tern', 'tide', 'wake', 'wharf',
];

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function generateSlug(): string {
  return `${pick(adjectives)}-${pick(nouns)}-${randomId(4)}`;
}
