// Unit tests for the pure OpenTDB transform (decode + shuffle into our question shape).
// No network, no emulator.
import { test, expect } from "vitest";
import { decodeB64, toQuestion, fetchQuestions } from "../web/shared/opentdb.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("decodeB64 decodes base64 UTF-8", () => {
  expect(decodeB64(b64("Café déjà vu"))).toBe("Café déjà vu");
});

const dto = {
  question: b64("What is 2 + 2?"),
  correct_answer: b64("4"),
  incorrect_answers: [b64("3"), b64("5"), b64("22")],
};

test("toQuestion decodes the prompt and all answers", () => {
  const q = toQuestion(dto, () => 0);
  expect(q.prompt).toBe("What is 2 + 2?");
  expect(q.answers).toHaveLength(4);
  expect(new Set(q.answers)).toEqual(new Set(["4", "3", "5", "22"]));
});

test("correctIndex always points to the correct answer, whatever the shuffle", () => {
  for (const rand of [() => 0, () => 0.99, () => 0.5, Math.random]) {
    const q = toQuestion(dto, rand);
    expect(q.answers[q.correctIndex]).toBe("4");
  }
});

test("fetchQuestions builds the URL with amount, type, category and difficulty", async () => {
  let calledUrl = "";
  const fakeFetch = async (url) => { calledUrl = url; return { json: async () => ({ response_code: 0, results: [dto] }) }; };
  const out = await fetchQuestions({ amount: 5, category: 9, difficulty: "easy", fetchImpl: fakeFetch });
  expect(calledUrl).toContain("amount=5");
  expect(calledUrl).toContain("type=multiple");
  expect(calledUrl).toContain("encode=base64");
  expect(calledUrl).toContain("category=9");
  expect(calledUrl).toContain("difficulty=easy");
  expect(out).toHaveLength(1);
});

test("fetchQuestions omits category and difficulty when not given", async () => {
  let calledUrl = "";
  const fakeFetch = async (url) => { calledUrl = url; return { json: async () => ({ response_code: 0, results: [] }) }; };
  await fetchQuestions({ amount: 5, fetchImpl: fakeFetch });
  expect(calledUrl).not.toContain("category=");
  expect(calledUrl).not.toContain("difficulty=");
});
