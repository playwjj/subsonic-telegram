// Minimal reactive singleton — no Pinia needed at this size. Credentials are
// stored in localStorage and attached to every Subsonic API call, the same
// model any Subsonic client uses (see api/subsonic.ts).
//
// What's stored is the Subsonic token (t = md5(password + salt)) and its
// salt, never the password: the URLs the UI builds (streams, covers,
// downloads) end up in history and logs, and those then don't give the
// password away. The salt is fixed per login so those URLs stay stable and
// cacheable.
import { reactive } from "vue";
import { md5Hex } from "../utils/md5";

const STORAGE_KEY = "subsonic-telegram:credentials";

export interface Credentials {
  username: string;
  token: string;
  salt: string;
}

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function credentialsFor(username: string, password: string): Credentials {
  const salt = randomSalt();
  return { username, token: md5Hex(password + salt), salt };
}

function load(): Credentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Credentials> & { password?: string };
    if (!stored.username) return null;
    // Saved by an older version, password and all: switch it over.
    if (stored.password !== undefined) {
      const creds = credentialsFor(stored.username, stored.password);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
      return creds;
    }
    return stored.token && stored.salt ? (stored as Credentials) : null;
  } catch {
    return null;
  }
}

const state = reactive<{ credentials: Credentials | null }>({ credentials: load() });

export function getCredentials(): Credentials {
  return state.credentials ?? { username: "", token: "", salt: "" };
}

export function isLoggedIn(): boolean {
  return state.credentials !== null;
}

export function setCredentials(creds: Credentials): void {
  state.credentials = creds;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // private mode etc. — stays logged in for this page load only
  }
}

export function logout(): void {
  state.credentials = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
