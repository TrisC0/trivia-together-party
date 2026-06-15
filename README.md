# Trivia Together — Party (web host + phone join)

The **Together** mode for Trivia Together: a Jackbox-style live trivia front-end.
A big-screen **host** page shows a room code and the current question; players
**join from their phone** (no install) and answer. Plain static HTML/JS, no build
step, running on Firebase Realtime Database and served by Firebase Hosting.

> **Two repos, one project.** This web front-end lives in its own GitHub repo
> (`TrisC0/trivia-together-party`), separate from the Android app repo
> (`TrisC0/trivia-together`). **Both are the same product and share one Firebase
> project** — Auth, Realtime Database, Firestore, and Hosting. This repo owns the
> web host/join pages, Hosting config, and the **Realtime Database** rules; the
> Android repo owns the app and the **Firestore** rules.

## Layout

```
web/
  host/index.html      big-screen display — the only authority over the round
  join/index.html      phone controller
  shared/firebase.js   Firebase SDK init + anonymous auth (emulator on localhost)
  shared/room.js       the only module that touches RTDB paths
  shared/questions.js  question bank (3 hardcoded for now)
database.rules.json    Realtime Database security rules (host-authoritative)
firebase.json          Hosting + Database + emulator config
firebase-tests/        rules-boundary + end-to-end flow tests (Vitest)
```

## Run locally (emulator — no real credentials needed)

```bash
npm install -g firebase-tools          # one-time
firebase emulators:start --only hosting,database,auth --project trivia-together-demo
#   host screen:  http://localhost:5000/host
#   phone join:   http://localhost:5000/join   (or a phone on the same LAN)
```

## Test

```bash
cd firebase-tests && npm install       # one-time
cd .. && firebase emulators:exec --only database,auth --project trivia-together-demo \
  "cd firebase-tests && npm test"
```

7 tests: 6 security-rule boundary checks + 1 real-anon-auth end-to-end flow
(host → join → answer → reveal scores correctly).

## Security model

Enforced by `database.rules.json`, not the UI:

- The **host** is authoritative — only the host creates/owns a room and writes
  scores and the answer reveal.
- A **player** (anonymous auth) writes only their own join and their own answer,
  only during the `question` phase, and only once.
- Raw answers live at `answers/{code}` with **host-only read**, so players can't
  see each other's in-flight answers (RTDB read access cascades and can't be
  revoked deeper, so the data is kept on a path players can't read).

Client `firebaseConfig` values are **not secrets** and are safe in this public
repo; security comes from the rules. Server-side admin keys must never be
committed (see `.gitignore`).

## Deploy (later — needs the real shared Firebase project)

```bash
firebase deploy --only hosting,database --project <real-project-id>
```

Custom domain `triviatogether.xyz` is wired in the Firebase Console at deploy
time (Firebase supplies the exact DNS records).
