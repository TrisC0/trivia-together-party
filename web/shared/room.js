// The only module that touches RTDB paths. Paths mirror database.rules.json.
import { db } from "./firebase.js";
import { roundScore, QUESTION_DURATION_MS } from "./scoring.js";
import {
  ref, set, update, get, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Track the RTDB server clock so countdowns survive client clock skew.
let serverOffset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (s) => { serverOffset = s.val() || 0; });
/** Current time corrected to the server clock (ms). */
export function serverNow() { return Date.now() + serverOffset; }

/** 4-char A–Z room code. */
export function randomCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let s = "";
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** Host: create a room owned by `uid`. Retries on code collision. Returns the code. */
export async function createRoom(uid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const snap = await get(ref(db, `rooms/${code}`));
    if (snap.exists()) continue;
    await set(ref(db, `rooms/${code}`), {
      host: uid,
      status: "lobby",
      createdAt: serverTimestamp(),
      currentQuestionIndex: 0,
    });
    return code;
  }
  throw new Error("Could not allocate a room code");
}

/** Player: join `code` as `uid` with `name`. Throws if the room does not exist. */
export async function joinRoom(code, uid, name, avatar = "🙂") {
  const snap = await get(ref(db, `rooms/${code}`));
  if (!snap.exists()) throw new Error("Room not found");
  // `update` (not `set`) and no onDisconnect removal, so a refresh/reconnect keeps the
  // player's slot and host-assigned score. No `score` here — it stays host-authoritative.
  await update(ref(db, `rooms/${code}/players/${uid}`), {
    name: name.slice(0, 24), avatar, joinedAt: serverTimestamp(),
  });
}

/** One-time read of a room (null if it doesn't exist). Used for reconnect-resume. */
export async function getRoom(code) {
  return (await get(ref(db, `rooms/${code}`))).val();
}

/** Subscribe to the whole room object. Returns an unsubscribe function. */
export function observeRoom(code, cb) {
  return onValue(ref(db, `rooms/${code}`), (snap) => cb(snap.val()));
}

/** Host: live count of answers submitted for a question (used to reveal early). */
export function observeAnswerCount(code, qIndex, cb) {
  return onValue(ref(db, `answers/${code}/${qIndex}`), (snap) => cb(snap.size));
}

/** Host: push question `qIndex` (no correct answer) and enter the question phase. */
export async function startQuestion(code, qIndex, q) {
  await update(ref(db, `rooms/${code}`), {
    status: "question",
    currentQuestionIndex: qIndex,
    question: { index: qIndex, prompt: q.prompt, answers: q.answers, startedAt: serverTimestamp() },
    reveal: null,
  });
}

/** Player: submit `choice` for question `qIndex`. Rules block re-submits. */
export async function submitAnswer(code, qIndex, uid, choice) {
  await set(ref(db, `answers/${code}/${qIndex}/${uid}`), {
    choice, answeredAt: serverTimestamp(),
  });
}

/** Host: grade answers for `qIndex`, write scores, then publish the reveal. */
export async function revealAndScore(code, qIndex, correctIndex) {
  const status = (await get(ref(db, `rooms/${code}/status`))).val();
  if (status !== "question") return; // already revealed — idempotent
  const answers = (await get(ref(db, `answers/${code}/${qIndex}`))).val() || {};
  const players = (await get(ref(db, `rooms/${code}/players`))).val() || {};
  const startedAt = (await get(ref(db, `rooms/${code}/question/startedAt`))).val() || 0;
  const updates = {};
  for (const id of Object.keys(players)) {
    const ans = answers[id];
    const correct = !!ans && ans.choice === correctIndex;
    const points = roundScore({
      correct,
      answeredAt: ans ? ans.answeredAt : 0,
      startedAt,
      durationMs: QUESTION_DURATION_MS,
    });
    updates[`rooms/${code}/players/${id}/score`] = (players[id].score || 0) + points;
  }
  updates[`rooms/${code}/reveal`] = { questionIndex: qIndex, correctIndex };
  updates[`rooms/${code}/status`] = "reveal";
  await update(ref(db), updates);
}

/** Host: end the game and show the final leaderboard. */
export async function endGame(code) {
  await update(ref(db, `rooms/${code}`), { status: "ended" });
}

/** Host: reset to the lobby for a new game, zeroing every player's score. */
export async function resetGame(code) {
  const players = (await get(ref(db, `rooms/${code}/players`))).val() || {};
  const updates = {};
  for (const id of Object.keys(players)) updates[`rooms/${code}/players/${id}/score`] = 0;
  updates[`rooms/${code}/status`] = "lobby";
  updates[`rooms/${code}/currentQuestionIndex`] = 0;
  updates[`rooms/${code}/question`] = null;
  updates[`rooms/${code}/reveal`] = null;
  updates[`answers/${code}`] = null;
  await update(ref(db), updates);
}
