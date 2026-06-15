// Open Trivia DB client + pure transforms. No Firebase imports, so it runs in the
// browser (host page) and in Node (unit tests). OpenTDB is free, no API key.

/** Decode a base64 (encode=base64) field into a UTF-8 string. Works in browser + Node. */
export function decodeB64(s) {
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Fisher–Yates shuffle in place, using an injectable RNG (deterministic in tests).
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Turn one base64 OpenTDB question DTO into our shape, with answers shuffled so the
 * correct one isn't always first. correctIndex always points at the correct answer.
 */
export function toQuestion(dto, rand = Math.random) {
  const correct = decodeB64(dto.correct_answer);
  const options = shuffle([correct, ...dto.incorrect_answers.map(decodeB64)], rand);
  return {
    prompt: decodeB64(dto.question),
    answers: options,
    correctIndex: options.indexOf(correct),
  };
}

/** A curated subset of OpenTDB categories for the host picker (id + label). */
export const CATEGORIES = [
  { id: null, label: "Any category" },
  { id: 9, label: "General Knowledge" },
  { id: 17, label: "Science & Nature" },
  { id: 18, label: "Computers" },
  { id: 22, label: "Geography" },
  { id: 23, label: "History" },
  { id: 11, label: "Film" },
  { id: 12, label: "Music" },
  { id: 15, label: "Video Games" },
  { id: 21, label: "Sports" },
];

/** OpenTDB difficulty levels for the host picker. */
export const DIFFICULTIES = [
  { id: null, label: "Any difficulty" },
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

/**
 * Fetch a round of multiple-choice questions from OpenTDB. Returns [] on any
 * failure (caller falls back to the bundled bank). fetchImpl is injectable for tests.
 */
export async function fetchQuestions({
  amount = 8, category = null, difficulty = null, fetchImpl = fetch, baseUrl = "https://opentdb.com/api.php",
} = {}) {
  const params = new URLSearchParams({ amount: String(amount), type: "multiple", encode: "base64" });
  if (category) params.set("category", String(category));
  if (difficulty) params.set("difficulty", String(difficulty));
  try {
    const res = await fetchImpl(`${baseUrl}?${params.toString()}`);
    const data = await res.json();
    if (data.response_code !== 0 || !Array.isArray(data.results) || data.results.length === 0) return [];
    return data.results.map((d) => toQuestion(d));
  } catch {
    return [];
  }
}
