// End-to-end data-flow test for the Together slice. Replays the exact sequence the
// host and join pages perform (host creates room, player joins, host asks a question,
// player answers, host reveals + scores) using REAL anonymous auth against the
// emulator — so it exercises database.rules.json the way real clients do, not the
// admin context the rules.test.js uses. Reuses the real question bank.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, test, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInAnonymously } from "firebase/auth";
import {
  getDatabase, connectDatabaseEmulator, ref, set, update, get, serverTimestamp,
} from "firebase/database";

const here = dirname(fileURLToPath(import.meta.url));
const { QUESTIONS } = await import(resolve(here, "../web/shared/questions.js"));

const config = {
  apiKey: "demo-key",
  projectId: "trivia-together-demo",
  databaseURL: "https://trivia-together-demo-default-rtdb.firebaseio.com",
  appId: "demo-app",
};

// Two independent apps so host and player are two distinct anonymous users.
function makeClient(name) {
  const app = initializeApp(config, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  return { app, auth, db };
}

let host, player;

beforeAll(() => { host = makeClient("host"); player = makeClient("player"); });
afterAll(async () => { await deleteApp(host.app); await deleteApp(player.app); });

test("host→join→answer→reveal scores a correct answer as 1", async () => {
  const code = "ZZZA";
  const Q = 0;
  const q = QUESTIONS[Q];

  // Host signs in and creates the room.
  const hostUid = (await signInAnonymously(host.auth)).user.uid;
  await set(ref(host.db, `rooms/${code}`), {
    host: hostUid, status: "lobby", createdAt: serverTimestamp(), currentQuestionIndex: 0,
  });

  // Player signs in and joins.
  const playerUid = (await signInAnonymously(player.auth)).user.uid;
  // No score on join — it's host-authoritative (see database.rules.json / room.js).
  await set(ref(player.db, `rooms/${code}/players/${playerUid}`), {
    name: "Pat", joinedAt: serverTimestamp(),
  });

  // Host asks the question.
  await update(ref(host.db, `rooms/${code}`), {
    status: "question",
    currentQuestionIndex: Q,
    question: { index: Q, prompt: q.prompt, answers: q.answers },
  });

  // Player submits the correct answer.
  await set(ref(player.db, `answers/${code}/${Q}/${playerUid}`), {
    choice: q.correctIndex, answeredAt: serverTimestamp(),
  });

  // Host reveals + scores (mirrors room.js revealAndScore).
  const answers = (await get(ref(host.db, `answers/${code}/${Q}`))).val() || {};
  const players = (await get(ref(host.db, `rooms/${code}/players`))).val() || {};
  const updates = {};
  for (const uid of Object.keys(players)) {
    const correct = answers[uid] && answers[uid].choice === q.correctIndex;
    updates[`rooms/${code}/players/${uid}/score`] = (players[uid].score || 0) + (correct ? 1 : 0);
  }
  updates[`rooms/${code}/reveal`] = { questionIndex: Q, correctIndex: q.correctIndex };
  updates[`rooms/${code}/status`] = "reveal";
  await update(ref(host.db), updates);

  // Player sees the reveal and a score of 1.
  const room = (await get(ref(player.db, `rooms/${code}`))).val();
  expect(room.status).toBe("reveal");
  expect(room.reveal.correctIndex).toBe(q.correctIndex);
  expect(room.players[playerUid].score).toBe(1);
});
