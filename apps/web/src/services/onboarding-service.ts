const KEY = "nodra.onboarding.welcome.dismissed";

/** La bannière de bienvenue est visible tant qu'elle n'a pas été masquée. */
export function loadWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissWelcomeBanner() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}
