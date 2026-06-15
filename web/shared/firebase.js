// Firebase init for the Together web app. Uses the v10 modular SDK from CDN.
// On localhost it auto-connects to the emulator, so no real project is needed.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, connectAuthEmulator, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Placeholder config — overwritten with the real firebaseConfig at deploy time.
// These values are NOT secrets; security comes from database.rules.json.
const firebaseConfig = {
  apiKey: "demo-key",
  projectId: "trivia-together-demo",
  databaseURL: "http://localhost:9000?ns=trivia-together-demo-default-rtdb",
  appId: "demo-app",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

const onLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
if (onLocalhost) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "localhost", 9000);
}

/** Signs in anonymously and resolves with the uid. */
export function signInAnon() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => { if (user) resolve(user.uid); });
    signInAnonymously(auth).catch(reject);
  });
}
