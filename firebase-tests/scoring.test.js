// Unit tests for the pure speed-bonus scoring function. No emulator needed.
import { test, expect } from "vitest";
import { roundScore, BASE_POINTS, SPEED_POINTS, QUESTION_DURATION_MS }
  from "../web/shared/scoring.js";

const D = QUESTION_DURATION_MS;

test("a wrong answer scores zero", () => {
  expect(roundScore({ correct: false, answeredAt: 100, startedAt: 0, durationMs: D })).toBe(0);
});

test("an instant correct answer scores the full base + speed bonus", () => {
  expect(roundScore({ correct: true, answeredAt: 0, startedAt: 0, durationMs: D }))
    .toBe(BASE_POINTS + SPEED_POINTS);
});

test("a correct answer at half time scores base + half the speed bonus", () => {
  expect(roundScore({ correct: true, answeredAt: D / 2, startedAt: 0, durationMs: D }))
    .toBe(BASE_POINTS + SPEED_POINTS / 2);
});

test("a correct answer right at the deadline scores only the base", () => {
  expect(roundScore({ correct: true, answeredAt: D, startedAt: 0, durationMs: D }))
    .toBe(BASE_POINTS);
});

test("a correct answer after the deadline is clamped to the base (never negative)", () => {
  expect(roundScore({ correct: true, answeredAt: D + 5000, startedAt: 0, durationMs: D }))
    .toBe(BASE_POINTS);
});
