import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import Avatar from "../components/Avatar";
import "../css/Dares.css";
import "../css/Live.css";

const API = "https://chatapp-system-mbzq.onrender.com";

export default function LivePage() {
  const token = localStorage.getItem("token");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const dareId = params.get("dare");
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState(params.get("title") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/live`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setRooms(await res.json());
    } catch { /* keep list */ }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
    const socket = io(API, { auth: { token } });
    socket.on("liveChanged", load);
    const id = setInterval(load, 20000);
    return () => { clearInterval(id); socket.disconnect(); };
  }, [token, load]);

  async function goLive() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/live`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title, dareId: dareId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not start the live.");
      navigate(`/live/${data.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="dares-page live-page">
      <header className="dares-header">
        <div>
          <p className="dares-eyebrow">LIVE</p>
          <h1>Live with friends</h1>
        </div>
      </header>

      <section className="live-start">
        <p className="dares-label">{dareId ? "Go live for your dare" : "Go live"}</p>
        <input
          className="dares-input"
          placeholder="What are you doing live?"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {error && <p className="dares-error" role="alert">{error}</p>}
        <div className="dares-actions">
          <button type="button" className="dares-btn dares-btn-primary" disabled={busy || title.trim().length < 3} onClick={goLive}>
            {busy ? "Starting…" : "Start live"}
          </button>
        </div>
        <p className="dares-muted dares-small">Only your friends can watch. Your camera and microphone turn on when the live starts.</p>
      </section>

      <p className="dares-label">Live now</p>
      <section className="dares-list">
        {loading ? <p className="dares-muted">Loading…</p> : rooms.length === 0 ? (
          <p className="dares-empty">Nobody is live right now.</p>
        ) : rooms.map((r) => (
          <button type="button" key={r.id} className="dare-card" onClick={() => navigate(`/live/${r.id}`)}>
            <Avatar src={r.host_avatar} name={r.host_username} className="dare-card-avatar" />
            <div className="dare-card-body">
              <p className="dare-card-who">{r.host_username}</p>
              <p className="dare-card-text">{r.title}</p>
              <p className="dare-card-meta"><span className="live-badge">LIVE</span>{r.dare_id && <span>Dare</span>}</p>
            </div>
          </button>
        ))}
      </section>
    </main>
  );
}
