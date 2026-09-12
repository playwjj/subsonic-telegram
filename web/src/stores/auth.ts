// Minimal reactive singleton — no Pinia needed at this size. Credentials are
// stored in localStorage and attached to every Subsonic API call, the same
// model any Subsonic client uses (see api/subsonic.ts).
import { reactive } from "vue";

const STORAGE_KEY = "subsonic-telegram:credentials";

export interface Credentials {
  username: string;
  password: string;
}

function load(): Credentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

const state = reactive<{ credentials: Credentials | null }>({ credentials: load() });

export function getCredentials(): Credentials {
  return state.credentials ?? { username: "", password: "" };
}

export function isLoggedIn(): boolean {
  return state.credentials !== null;
}

export function setCredentials(creds: Credentials): void {
  state.credentials = creds;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function logout(): void {
  state.credentials = null;
  localStorage.removeItem(STORAGE_KEY);
}
