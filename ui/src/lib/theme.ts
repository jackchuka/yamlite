export type ThemeChoice = "light" | "dark" | "system";
const KEY = "yamlite-theme";

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export const resolveTheme = (choice: ThemeChoice, prefersDark: boolean): "light" | "dark" =>
  choice === "system" ? (prefersDark ? "dark" : "light") : choice;

export function applyTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage can be blocked; the choice then lasts until reload
  }
  document.documentElement.dataset.theme = resolveTheme(choice, matchMedia("(prefers-color-scheme: dark)").matches);
}

export const nextChoice = (choice: ThemeChoice): ThemeChoice =>
  choice === "system" ? "light" : choice === "light" ? "dark" : "system";
