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
