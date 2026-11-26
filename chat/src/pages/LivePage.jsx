import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import Avatar from "../components/Avatar";
import ShareWithFriendsDialog from "../components/ShareWithFriendsDialog";
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
  const [visibility, setVisibility] = useState("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(null);

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
    socket.on("live:join-request", load);
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
        body: JSON.stringify({ title, dareId: dareId || undefined, visibility }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not start the live.");
      navigate(`/live/${data.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function shareLive(room) {
    const url = `${window.location.origin}/live/${room.id}`;
    setSharing({
      title: "Share this live",
      description: `Send ${room.host_username}'s live to your friends.`,
      message: `Join ${room.host_username}'s live "${room.title}": ${url}`,
    });
  }

  return (
    <main className="dares-page live-page live-discovery-page">
      <header className="dares-header live-page-header">
        <div>
          <p className="dares-eyebrow">LIVE</p>
          <h1>Live rooms</h1>
          <p>Drop in, say hello, and share the moment.</p>
        </div>
      </header>

      <section className="live-start">
        <div className="live-start-heading">
          <span className="live-start-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 7h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><path d="m16 10 6-3v10l-6-3z" /></svg>
          </span>
          <div>
            <p className="dares-label">{dareId ? "Go live for your dare" : "Start a live"}</p>
            <p className="dares-muted dares-small">Your camera and microphone start after you open the room.</p>
          </div>
        </div>
        <input className="dares-input" placeholder="Give your live a title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />

        <fieldset className="live-visibility-options">
          <legend>Who can join?</legend>
          <label className={visibility === "public" ? "selected" : ""}>
            <input type="radio" name="live-visibility" value="public" checked={visibility === "public"} onChange={() => setVisibility("public")} />
            <span className="live-visibility-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
            </span>
            <span><strong>Public</strong><small>Anyone can join right away</small></span>
          </label>
          <label className={visibility === "private" ? "selected" : ""}>
            <input type="radio" name="live-visibility" value="private" checked={visibility === "private"} onChange={() => setVisibility("private")} />
            <span className="live-visibility-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>
            </span>
            <span><strong>Private</strong><small>Friends request; you approve them</small></span>
          </label>
        </fieldset>

        {error && <p className="dares-error" role="alert">{error}</p>}
        <div className="dares-actions">
          <button type="button" className="dares-btn dares-btn-primary live-start-button" disabled={busy || title.trim().length < 3} onClick={goLive}>
            {busy ? "Starting…" : "Start live"}
          </button>
        </div>
      </section>

      <div className="live-list-heading">
        <div><p className="dares-eyebrow">HAPPENING NOW</p><h2>Live now</h2></div>
        <span>{rooms.length} {rooms.length === 1 ? "room" : "rooms"}</span>
      </div>
      <section className="dares-list live-room-list">
        {loading ? <p className="dares-muted">Loading…</p> : rooms.length === 0 ? (
          <div className="live-empty-state">
            <span className="live-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 7h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><path d="m16 10 6-3v10l-6-3z" /></svg>
            </span>
            <strong>No one is live just yet</strong>
            <span>Start a room and your friends can join in.</span>
          </div>
        ) : rooms.map((r) => (
          <article key={r.id} className="live-room-card">
            <button type="button" className="live-room-open" onClick={() => navigate(`/live/${r.id}`)}>
              <Avatar src={r.host_avatar} name={r.host_username} className="dare-card-avatar" />
              <span className="live-room-card-body">
                <span className="live-room-card-host">{r.host_username}</span>
                <strong>{r.title}</strong>
                <span className="live-room-card-meta">
                  <span className="live-badge">LIVE</span>
                  <span className={`live-privacy-badge ${r.visibility === "private" ? "private" : ""}`}>{r.visibility === "private" ? "Private · request to join" : "Public"}</span>
                  {Number(r.pending_requests) > 0 && <span className="live-pending-count">{r.pending_requests} waiting</span>}
                  {r.dare_id && <span>Dare</span>}
                </span>
              </span>
              <span className="live-room-card-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
              </span>
            </button>
            <button type="button" className="live-room-share" onClick={() => shareLive(r)} aria-label={`Share ${r.host_username}'s live`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
            </button>
          </article>
        ))}
      </section>
      {sharing && (
        <ShareWithFriendsDialog
          token={token}
          title={sharing.title}
          description={sharing.description}
          message={sharing.message}
          onClose={() => setSharing(null)}
        />
      )}
    </main>
  );
}
