import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, beforeEach, test, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";

const here = dirname(fileURLToPath(import.meta.url));
let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "trivia-together-demo",
    database: {
      host: "localhost",
      port: 9000,
      rules: readFileSync(resolve(here, "../database.rules.json"), "utf8"),
    },
  });
});

afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const CODE = "ABCD";

// Seed a room owned by `hostUid` with the given status, bypassing rules.
async function seedRoom(hostUid, status) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `rooms/${CODE}`), {
      host: hostUid,
      status,
      createdAt: 1,
      currentQuestionIndex: 0,
    });
  });
}

test("host can create a room with itself as host", async () => {
  const host = env.authenticatedContext("host1").database();
  await assertSucceeds(
    set(ref(host, `rooms/${CODE}`), { host: "host1", status: "lobby", createdAt: 1 })
  );
});

test("a user cannot create a room owned by someone else", async () => {
  const mallory = env.authenticatedContext("mallory").database();
  await assertFails(
    set(ref(mallory, `rooms/${CODE}`), { host: "host1", status: "lobby", createdAt: 1 })
  );
});

test("a player can write only their own player node", async () => {
  await seedRoom("host1", "lobby");
  const p = env.authenticatedContext("player1").database();
  await assertSucceeds(set(ref(p, `rooms/${CODE}/players/player1`), { name: "Pat", joinedAt: 1 }));
  await assertFails(set(ref(p, `rooms/${CODE}/players/player2`), { name: "Evil", joinedAt: 1 }));
});

test("a player cannot set their own score", async () => {
  await seedRoom("host1", "lobby");
  const p = env.authenticatedContext("player1").database();
  await assertFails(
    set(ref(p, `rooms/${CODE}/players/player1`), { name: "Pat", joinedAt: 1, score: 9999 })
  );
});

test("a player can answer only during the question phase, and only once", async () => {
  await seedRoom("host1", "lobby");
  const p = env.authenticatedContext("player1").database();
  // lobby phase -> rejected
  await assertFails(set(ref(p, `answers/${CODE}/0/player1`), { choice: 1, answeredAt: 1 }));
  // flip to question phase
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `rooms/${CODE}/status`), "question");
  });
  await assertSucceeds(set(ref(p, `answers/${CODE}/0/player1`), { choice: 1, answeredAt: 1 }));
  // second write -> rejected (no overwrite)
  await assertFails(set(ref(p, `answers/${CODE}/0/player1`), { choice: 2, answeredAt: 2 }));
});

test("players cannot read answers; the host can", async () => {
  await seedRoom("host1", "question");
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `answers/${CODE}/0/player1`), { choice: 1, answeredAt: 1 });
  });
  const player = env.authenticatedContext("player2").database();
  const host = env.authenticatedContext("host1").database();
  await assertFails(get(ref(player, `answers/${CODE}`)));
  await assertSucceeds(get(ref(host, `answers/${CODE}`)));
});
