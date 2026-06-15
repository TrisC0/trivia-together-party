// The only module that touches RTDB paths. Paths mirror database.rules.json.
import { db } from "./firebase.js";
import { QUESTIONS } from "./questions.js";
import {
  ref, set, update, get, child, onValue, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
export async function joinRoom(code, uid, name) {
  const snap = await get(ref(db, `rooms/${code}`));
  if (!snap.exists()) throw new Error("Room not found");
  const meRef = ref(db, `rooms/${code}/players/${uid}`);
  // No `score` here: the rules make score host-authoritative, so a player may not
  // write it. Score is absent until the host sets it in revealAndScore; readers use `|| 0`.
  await set(meRef, { name: name.slice(0, 24), joinedAt: serverTimestamp() });
  onDisconnect(meRef).remove();
}

/** Subscribe to the whole room object. Returns an unsubscribe function. */
export function observeRoom(code, cb) {
  return onValue(ref(db, `rooms/${code}`), (snap) => cb(snap.val()));
}

/** Host: push question `qIndex` (no correct answer) and enter the question phase. */
export async function startQuestion(code, qIndex) {
  const q = QUESTIONS[qIndex];
  await update(ref(db, `rooms/${code}`), {
    status: "question",
    currentQuestionIndex: qIndex,
    question: { index: qIndex, prompt: q.prompt, answers: q.answers },
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
export async function revealAndScore(code, qIndex) {
  const q = QUESTIONS[qIndex];
  const ansSnap = await get(ref(db, `answers/${code}/${qIndex}`));
  const answers = ansSnap.val() || {};
  const playersSnap = await get(ref(db, `rooms/${code}/players`));
  const players = playersSnap.val() || {};
  const updates = {};
  for (const uid of Object.keys(players)) {
    const correct = answers[uid] && answers[uid].choice === q.correctIndex;
    const current = players[uid].score || 0;
    updates[`rooms/${code}/players/${uid}/score`] = current + (correct ? 1 : 0);
  }
  updates[`rooms/${code}/reveal`] = { questionIndex: qIndex, correctIndex: q.correctIndex };
  updates[`rooms/${code}/status`] = "reveal";
  await update(ref(db), updates);
}
