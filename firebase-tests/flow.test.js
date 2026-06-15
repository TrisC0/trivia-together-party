// End-to-end data-flow test for a full Together game. Replays the sequence the host
// and join pages perform (mirroring web/shared/room.js) using REAL anonymous auth
// against the emulator, so it exercises database.rules.json the way real clients do.
// Uses fixed timestamps so the speed-bonus scores are deterministic.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, test, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInAnonymously } from "firebase/auth";
import { getDatabase, connectDatabaseEmulator, ref, set, update, get } from "firebase/database";

const here = dirname(fileURLToPath(import.meta.url));
const { QUESTIONS } = await import(resolve(here, "../web/shared/questions.js"));
const { roundScore, QUESTION_DURATION_MS, BASE_POINTS, SPEED_POINTS } =
  await import(resolve(here, "../web/shared/scoring.js"));

const config = {
  apiKey: "demo-key",
  projectId: "trivia-together-demo",
  databaseURL: "https://trivia-together-demo-default-rtdb.firebaseio.com",
  appId: "demo-app",
};

function makeClient(name) {
  const app = initializeApp(config, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  return { app, auth, db, uid: null };
}

const CODE = "GAME";
const D = QUESTION_DURATION_MS;
let host, a, b;

beforeAll(async () => {
  host = makeClient("host"); a = makeClient("pa"); b = makeClient("pb");
  for (const c of [host, a, b]) c.uid = (await signInAnonymously(c.auth)).user.uid;
});
afterAll(async () => { for (const c of [host, a, b]) await deleteApp(c.app); });

// --- host/player actions, mirroring web/shared/room.js ---
async function createRoom() {
  await set(ref(host.db, `rooms/${CODE}`), {
    host: host.uid, status: "lobby", createdAt: 1, currentQuestionIndex: 0,
  });
}
async function join(c, name) {
  // update (not set), mirroring room.js, so a rejoin never clobbers an existing score
  await update(ref(c.db, `rooms/${CODE}/players/${c.uid}`), { name, joinedAt: 1 });
}
async function startQuestion(qIndex, startedAt) {
  const q = QUESTIONS[qIndex];
  await update(ref(host.db, `rooms/${CODE}`), {
    status: "question",
    currentQuestionIndex: qIndex,
    question: { index: qIndex, prompt: q.prompt, answers: q.answers, startedAt },
    reveal: null,
  });
}
async function answer(c, qIndex, choice, answeredAt) {
  await set(ref(c.db, `answers/${CODE}/${qIndex}/${c.uid}`), { choice, answeredAt });
}
async function revealAndScore(qIndex) {
  const q = QUESTIONS[qIndex];
  const answers = (await get(ref(host.db, `answers/${CODE}/${qIndex}`))).val() || {};
  const players = (await get(ref(host.db, `rooms/${CODE}/players`))).val() || {};
  const startedAt = (await get(ref(host.db, `rooms/${CODE}/question/startedAt`))).val() || 0;
  const updates = {};
  for (const id of Object.keys(players)) {
    const ans = answers[id];
    const correct = !!ans && ans.choice === q.correctIndex;
    const points = roundScore({ correct, answeredAt: ans ? ans.answeredAt : 0, startedAt, durationMs: D });
    updates[`rooms/${CODE}/players/${id}/score`] = (players[id].score || 0) + points;
  }
  updates[`rooms/${CODE}/reveal`] = { questionIndex: qIndex, correctIndex: q.correctIndex };
  updates[`rooms/${CODE}/status`] = "reveal";
  await update(ref(host.db), updates);
}
async function endGame() { await update(ref(host.db, `rooms/${CODE}`), { status: "ended" }); }
// Idempotent reveal, mirroring web/shared/room.js revealAndScore: bail if not still "question".
async function revealAndScoreIdempotent(qIndex) {
  const status = (await get(ref(host.db, `rooms/${CODE}/status`))).val();
  if (status !== "question") return; // already revealed
  await revealAndScore(qIndex);
}
// Reset for a new game, mirroring web/shared/room.js resetGame (also clears answers/{code}).
async function resetGame() {
  const players = (await get(ref(host.db, `rooms/${CODE}/players`))).val() || {};
  const updates = {};
  for (const id of Object.keys(players)) updates[`rooms/${CODE}/players/${id}/score`] = 0;
  updates[`rooms/${CODE}/status`] = "lobby";
  updates[`rooms/${CODE}/currentQuestionIndex`] = 0;
  updates[`rooms/${CODE}/question`] = null;
  updates[`rooms/${CODE}/reveal`] = null;
  updates[`answers/${CODE}`] = null;
  await update(ref(host.db), updates);
}

test("a two-round game accumulates speed scores and ranks the final leaderboard", async () => {
  const q0 = QUESTIONS[0], q1 = QUESTIONS[1];
  await createRoom();
  await join(a, "Ana");
  await join(b, "Ben");

  // Round 0 — both correct; Ana instant (full), Ben at half time (base + half bonus).
  await startQuestion(0, 1000);
  await answer(a, 0, q0.correctIndex, 1000);       // instant -> BASE + SPEED
  await answer(b, 0, q0.correctIndex, 1000 + D / 2); // half   -> BASE + SPEED/2
  await revealAndScore(0);

  // Round 1 — Ana wrong, Ben instant correct.
  await startQuestion(1, 50000);
  await answer(a, 1, (q1.correctIndex + 1) % 4, 50000); // wrong -> 0
  await answer(b, 1, q1.correctIndex, 50000);           // instant -> BASE + SPEED
  await revealAndScore(1);

  await endGame();

  const room = (await get(ref(host.db, `rooms/${CODE}`))).val();
  expect(room.status).toBe("ended");
  expect(room.players[a.uid].score).toBe(BASE_POINTS + SPEED_POINTS);                  // 1000
  expect(room.players[b.uid].score).toBe((BASE_POINTS + SPEED_POINTS / 2) + (BASE_POINTS + SPEED_POINTS)); // 750 + 1000 = 1750

  const ranked = Object.values(room.players).sort((x, y) => y.score - x.score);
  expect(ranked[0].name).toBe("Ben");
  expect(ranked[1].name).toBe("Ana");
});

test("a player who rejoins (reconnect) keeps a host-assigned score", async () => {
  const C = "RJON";
  await set(ref(host.db, `rooms/${C}`), { host: host.uid, status: "lobby", createdAt: 1, currentQuestionIndex: 0 });
  await update(ref(a.db, `rooms/${C}/players/${a.uid}`), { name: "Ana", joinedAt: 1 });  // initial join
  await update(ref(host.db, `rooms/${C}/players/${a.uid}`), { score: 1234 });            // host scores
  await update(ref(a.db, `rooms/${C}/players/${a.uid}`), { name: "Ana", joinedAt: 2 });  // rejoin (update, no score)

  const player = (await get(ref(host.db, `rooms/${C}/players/${a.uid}`))).val();
  expect(player.score).toBe(1234);
  expect(player.name).toBe("Ana");
});

test("calling reveal twice does not double-score (idempotent reveal)", async () => {
  const q0 = QUESTIONS[0];
  await createRoom();
  await set(ref(host.db, `answers/${CODE}`), null); // host clears answers from earlier tests
  await join(a, "Ana");

  await startQuestion(0, 1000);
  await answer(a, 0, q0.correctIndex, 1000); // instant correct -> BASE + SPEED

  await revealAndScoreIdempotent(0); // first reveal scores and moves status -> "reveal"
  const afterFirst = (await get(ref(host.db, `rooms/${CODE}/players/${a.uid}/score`))).val();
  expect(afterFirst).toBe(BASE_POINTS + SPEED_POINTS);

  // Race: timer / all-answered / "Reveal now" all fire. Status is no longer "question",
  // so the guard must make this a no-op rather than scoring again.
  await revealAndScoreIdempotent(0);
  const afterSecond = (await get(ref(host.db, `rooms/${CODE}/players/${a.uid}/score`))).val();
  expect(afterSecond).toBe(BASE_POINTS + SPEED_POINTS); // unchanged — not doubled
});

test("resetGame clears the answers subtree so a replay isn't blocked", async () => {
  const q0 = QUESTIONS[0];
  await createRoom();
  await set(ref(host.db, `answers/${CODE}`), null); // host clears answers from earlier tests
  await join(a, "Ana");

  // Play a round so answers/{code}/0 exists.
  await startQuestion(0, 1000);
  await answer(a, 0, q0.correctIndex, 1000);
  await revealAndScoreIdempotent(0);
  expect((await get(ref(host.db, `answers/${CODE}`))).exists()).toBe(true);

  // Play again: reset must wipe answers (otherwise the `!data.exists()` rule blocks
  // returning players on reused question index 0).
  await resetGame();
  expect((await get(ref(host.db, `answers/${CODE}`))).exists()).toBe(false);
  expect((await get(ref(host.db, `rooms/${CODE}/players/${a.uid}/score`))).val()).toBe(0);

  // And the player can now answer index 0 again in the new game.
  await startQuestion(0, 2000);
  await answer(a, 0, q0.correctIndex, 2000);
  expect((await get(ref(host.db, `answers/${CODE}/0/${a.uid}`))).exists()).toBe(true);
});
