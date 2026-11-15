// Plain helper code shared by the Login and Sign-up pages (no UI in here).

export const API_URL = "https://chatapp-system-mbzq.onrender.com";
export const APP_NAME = "Morphues";
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sends the form to the server.
// Render's free server falls asleep when idle, so the first request can take up to a minute.
// If nothing has come back after 4 seconds we call onSlow() so the page can explain the wait.
export async function postAuth(path, body, onSlow) {
  const slowTimer = setTimeout(() => onSlow && onSlow(), 4000);
  const controller = new AbortController();
  const giveUpTimer = setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Something went wrong. Try again.");
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The server took too long to respond. Please try again.");
    }
    if (err instanceof TypeError) {
      throw new Error("Can't reach the server. Check your internet connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(giveUpTimer);
  }
}

// Remember who logged in, then open the app.
export function saveSession(data) {
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  window.location.href = "/inbox";
}

// Scores a password from 0 (empty) to 4 (strong) for the strength bar.
export function passwordStrength(password) {
  if (!password) return { score: 0, label: "" };
  let points = 0;
  if (password.length >= 6) points += 1;
  if (password.length >= 10) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) points += 1;
  const score = Math.max(1, points);
  return { score, label: ["", "Weak", "Fair", "Good", "Strong"][score] };
}