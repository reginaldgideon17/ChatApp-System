import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushState,
  isIOS,
  isInstalledApp,
  sendTestPush,
} from "../push";

export default function NotificationSettings() {
  const token = localStorage.getItem("token");
  const [state, setState] = useState("loading"); // loading | unsupported | denied | on | off
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, isError }

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  const iosNeedsInstall = isIOS() && !isInstalledApp();
  const canToggle = state === "on" || state === "off";

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    const result = await enablePush(token);
    setBusy(false);
    if (result.ok) {
      setState("on");
      setMessage({ text: "Notifications are on for this device.", isError: false });
    } else {
      setState(await getPushState());
      setMessage({ text: result.message, isError: true });
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush(token);
    setBusy(false);
    setState("off");
    setMessage({ text: "Notifications are off for this device.", isError: false });
  }

  async function test() {
    setBusy(true);
    const ok = await sendTestPush(token);
    setBusy(false);
    setMessage(ok
      ? { text: "Test sent. Switch to another tab or app to see it.", isError: false }
      : { text: "Could not send a test notification.", isError: true });
  }

  return (
    <section className="settings-card settings-notifications" aria-labelledby="notification-settings-title">
      <div className="settings-notification-row">
        <div>
          <h2 id="notification-settings-title">Notifications</h2>
          <p>Messages, dares, likes and friend requests · {state === "on" ? "On" : state === "off" ? "Off" : state === "loading" ? "Checking" : "Unavailable"}</p>
        </div>
        <button
          type="button"
          className="settings-notification-switch"
          role="switch"
          aria-checked={state === "on"}
          aria-label={state === "on" ? "Turn notifications off" : "Turn notifications on"}
          disabled={busy || !canToggle || (iosNeedsInstall && state !== "on")}
          onClick={state === "on" ? turnOff : turnOn}
        >
          <span />
        </button>
      </div>

      {iosNeedsInstall && (
        <p className="settings-notification-note">
          On iPhone: tap Share, then "Add to Home Screen", open Morphues from your home screen, and come back here to turn this on.
        </p>
      )}

      {state === "unsupported" && !iosNeedsInstall && (
        <p className="newchat-error">This browser does not support notifications.</p>
      )}
      {state === "denied" && (
        <p className="newchat-error">
          Notifications are blocked for this site. Allow them in your browser's site settings, then reload.
        </p>
      )}

      {state === "on" && (
        <div className="settings-notification-actions">
          <button type="button" className="newchat-add-button" onClick={test} disabled={busy}>Send a test</button>
        </div>
      )}

      {message && (
        <p className={message.isError ? "newchat-error" : "newchat-subtitle"}>{message.text}</p>
      )}
    </section>
  );
}
