// Whether Telegram storage is set up, asked once per page load: until it
// is, the router sends every page to the Setup page.
import { getTelegramSetup } from "../api/subsonic";

let configured: Promise<boolean> | undefined;

export function isStorageConfigured(): Promise<boolean> {
  // A failed check lets the app through (and is asked again next time):
  // a flaky connection shouldn't lock anyone out of their library.
  configured ??= getTelegramSetup().then(
    (s) => s.source !== "none",
    () => {
      configured = undefined;
      return true;
    },
  );
  return configured;
}

export function markStorageConfigured(): void {
  configured = Promise.resolve(true);
}
