// Pure speed-bonus scoring for a Together round. No Firebase imports, so it's
// importable both in the browser (host page) and in Node (unit tests).
//
// A correct answer earns BASE_POINTS plus up to SPEED_POINTS scaled by how much
// of the question's time was left when the player answered. Wrong/no answer = 0.

export const BASE_POINTS = 500;
export const SPEED_POINTS = 500;
export const QUESTION_DURATION_MS = 20_000;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * @param {{correct: boolean, answeredAt: number, startedAt: number, durationMs: number}} p
 * @returns {number} points for this round
 */
export function roundScore({ correct, answeredAt, startedAt, durationMs }) {
  if (!correct) return 0;
  const remaining = durationMs - (answeredAt - startedAt);
  const fraction = clamp01(remaining / durationMs);
  return BASE_POINTS + Math.round(SPEED_POINTS * fraction);
}
