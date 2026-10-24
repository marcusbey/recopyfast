/** Broad UTC review windows for the seasonal hints promised by s99. */

export type SeasonId =
  | "black-friday"
  | "cyber-monday"
  | "christmas"
  | "valentines"
  | "easter"
  | "summer"
  | "back-to-school"
  | "halloween"
  | "new-year"
  | "winter";

export interface SeasonMention {
  id: SeasonId;
  text: string;
  start: number;
  end: number;
}

interface SeasonDefinition {
  id: SeasonId;
  pattern: string;
  start: readonly [month: number, day: number];
  end: readonly [month: number, day: number];
}

const SEASONS: readonly SeasonDefinition[] = [
  {
    id: "black-friday",
    pattern: "black\\s+friday",
    start: [11, 15],
    end: [12, 5],
  },
  {
    id: "cyber-monday",
    pattern: "cyber\\s+monday",
    start: [11, 15],
    end: [12, 5],
  },
  {
    id: "christmas",
    pattern: "(?:christmas|holidays?)",
    start: [11, 15],
    end: [1, 6],
  },
  {
    id: "valentines",
    pattern: "valentine(?:'s|s)?",
    start: [1, 20],
    end: [2, 15],
  },
  { id: "easter", pattern: "easter", start: [3, 1], end: [4, 30] },
  { id: "summer", pattern: "summer", start: [6, 1], end: [8, 31] },
  {
    id: "back-to-school",
    pattern: "back\\s+to\\s+school",
    start: [8, 1],
    end: [9, 30],
  },
  { id: "halloween", pattern: "halloween", start: [10, 1], end: [10, 31] },
  {
    id: "new-year",
    pattern: "new\\s+year(?:'s)?",
    start: [12, 15],
    end: [1, 15],
  },
  { id: "winter", pattern: "winter", start: [12, 1], end: [2, 29] },
];

const dayKey = (month: number, day: number) => month * 100 + day;

export function findSeasonMentions(text: string): SeasonMention[] {
  const mentions: SeasonMention[] = [];
  for (const season of SEASONS) {
    const expression = new RegExp(`\\b(?:${season.pattern})\\b`, "giu");
    for (const match of text.matchAll(expression)) {
      const start = match.index ?? 0;
      mentions.push({
        id: season.id,
        text: match[0],
        start,
        end: start + match[0].length,
      });
    }
  }
  return mentions.sort((left, right) => left.start - right.start);
}

export function isInSeason(id: SeasonId, now: Date): boolean {
  const season = SEASONS.find((candidate) => candidate.id === id);
  if (!season) return false;
  const current = dayKey(now.getUTCMonth() + 1, now.getUTCDate());
  const start = dayKey(...season.start);
  const end = dayKey(...season.end);
  return start <= end
    ? current >= start && current <= end
    : current >= start || current <= end;
}
