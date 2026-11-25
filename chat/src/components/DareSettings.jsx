import { useCallback, useEffect, useState } from "react";
import Avatar from "./Avatar";
import "../css/Dares.css";

const API = "https://chatapp-system-mbzq.onrender.com";

// Settings card: turn dares on/off and manage the people you blocked from dares.
export default function DareSettings() {
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const [allow, setAllow] = useState(true);
  const [blocked, setBlocked] = useState([]);
  const [friends, setFriends] = useState([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/dares/settings`, { headers });
      if (!res.ok) throw new Error("Could not load dare settings.");
      const data = await res.json();
      setAllow(data.allowDares);
      setBlocked(data.blocked || []);
    } catch (err) {
      setError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    load();
    fetch(`${API}/api/friends`, { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then((l) => setFriends(Array.isArray(l) ? l : []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/dares/settings`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ allowDares: !allow }),
      });
      if (!res.ok) throw new Error("Could not save.");
      setAllow(!allow);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (!pick) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/dares/blocks/${pick}`, { method: "POST", headers });
      if (!res.ok) throw new Error("Could not block.");
      setPick("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function unblock(id) {
    setBusy(true);
    try {
      await fetch(`${API}/api/dares/blocks/${id}`, { method: "DELETE", headers });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const blockedIds = new Set(blocked.map((b) => String(b.id)));
  const options = friends.filter((f) => !blockedIds.has(String(f.id)));

  return (
    <section className="settings-card" aria-labelledby="dare-settings-title">
      <h2 id="dare-settings-title" className="settings-label">Dares</h2>
      <p className="dares-muted">Friends can dare you and you can earn points. Turn this off if you do not want any dares.</p>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <input type="checkbox" checked={allow} disabled={busy} onChange={toggle} />
        <span>Allow friends to send me dares</span>
      </label>

      <p className="settings-label" style={{ marginTop: 16 }}>Blocked from dares</p>
      {blocked.length === 0 && <p className="dares-muted">Nobody blocked.</p>}
      {blocked.map((b) => (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
          <Avatar src={b.avatar} name={b.username} className="dares-friend-avatar" />
          <span style={{ flex: 1 }}>{b.username}</span>
          <button type="button" className="dares-btn" disabled={busy} onClick={() => unblock(b.id)}>Unblock</button>
        </div>
      ))}

      {options.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <select className="dares-input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a friend to block…</option>
            {options.map((f) => <option key={f.id} value={f.id}>{f.username}</option>)}
          </select>
          <button type="button" className="dares-btn" disabled={busy || !pick} onClick={block}>Block</button>
        </div>
      )}
      {error && <p className="dares-error" role="alert">{error}</p>}
    </section>
  );
}
