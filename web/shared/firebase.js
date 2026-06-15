// Firebase init for the Together web app. Uses the v10 modular SDK from CDN.
// On localhost it auto-connects to the emulator, so no real project is needed.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, connectAuthEmulator, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Real client config for the `trivia-together` Firebase project. These values are
// NOT secrets (they ship to every browser); security comes from database.rules.json.
// On localhost the emulator connection below overrides the live endpoints.
const firebaseConfig = {
  apiKey: "AIzaSyBYGy6WsKKcadIsWzFNnuAkMFiBY58IJcc",
  authDomain: "trivia-together.firebaseapp.com",
  databaseURL: "https://trivia-together-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "trivia-together",
  storageBucket: "trivia-together.firebasestorage.app",
  messagingSenderId: "214453010577",
  appId: "1:214453010577:web:fffd5e99ded8e17c8bbf30",
  measurementId: "G-CS9Q4PLM27",
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
