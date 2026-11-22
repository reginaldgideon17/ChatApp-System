// chat/src/push.js  -  notifications helpers (in-tab alerts + Web Push)
const API = "https://chatapp-system-mbzq.onrender.com";
const PUSH_FLAG = "morphues-push"; // "1" when this browser has push turned on

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isInstalledApp() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// "unsupported" | "denied" | "on" | "off"
export async function getPushState() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "off";
  }
}

export async function enablePush(token) {
  if (!pushSupported()) return { ok: false, message: "This browser does not support notifications." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, message: "Notifications were blocked. Allow them in your browser's site settings, then try again." };
  }

  const keyRes = await fetch(`${API}/api/push/public-key`);
  const { enabled, key } = await keyRes.json();
  if (!enabled || !key) return { ok: false, message: "Push is not set up on the server yet." };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }

  const res = await fetch(`${API}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) return { ok: false, message: "Could not save your notification settings." };

  try { localStorage.setItem(PUSH_FLAG, "1"); } catch { /* ignore */ }
  return { ok: true };
}

export async function disablePush(token) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`${API}/api/push/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
  try { localStorage.removeItem(PUSH_FLAG); } catch { /* ignore */ }
}

export async function sendTestPush(token) {
  const res = await fetch(`${API}/api/push/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

// ---------- in-tab alerts ----------

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.22);
    });
  } catch { /* browsers may block sound until the first click */ }
}

/**
 * Call once from Layout with the live socket.
 * - plays a soft sound
 * - shows "(2) Morphues" in the tab title while the tab is hidden
 * - shows a system notification if the tab is hidden and Web Push is NOT on
 *   (when Web Push is on, the service worker shows it instead, so you never get two)
 * Returns a cleanup function.
 */
export function startInTabAlerts(socket, { getPath, navigate }) {
  const baseTitle = document.title || "Morphues";
  let unseen = 0;

  function resetTitle() {
    unseen = 0;
    document.title = baseTitle;
  }

  function onVisible() {
    if (!document.hidden) resetTitle();
  }

  function handle(alert) {
    const viewingThis = !document.hidden && getPath().startsWith(alert.url);
    if (viewingThis) return; // already looking at that chat

    beep();

    if (document.hidden) {
      unseen += 1;
      document.title = `(${unseen}) ${baseTitle}`;

      let pushOn = false;
      try { pushOn = localStorage.getItem(PUSH_FLAG) === "1"; } catch { /* ignore */ }
      if (!pushOn && "Notification" in window && Notification.permission === "granted") {
        navigator.serviceWorker?.ready.then((reg) =>
          reg.showNotification(alert.title, {
            body: alert.body,
            icon: "/icon-192.png",
            badge: "/badge-96.png",
            tag: alert.tag,
            data: { url: alert.url },
          })
        ).catch(() => {});
      }
    }
  }

  function onCall(data) {
    handle({
      title: data.fromUsername || "Someone",
      body: "is calling you",
      url: "/call-" + data.fromUserId, // never matches a page, so it always alerts
      tag: "call",
    });
  }

  function onSwMessage(event) {
    if (event.data && event.data.type === "navigate") navigate(event.data.url);
  }

  socket.on("appAlert", handle);
  socket.on("call:incoming", onCall);
  document.addEventListener("visibilitychange", onVisible);
  navigator.serviceWorker?.addEventListener("message", onSwMessage);

  return () => {
    socket.off("appAlert", handle);
    socket.off("call:incoming", onCall);
    document.removeEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    resetTitle();
  };
}
