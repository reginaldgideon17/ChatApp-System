import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import Avatar from "../components/Avatar";
import { readFileAsDataUrl } from "../attachmentUtils";
import "../css/Dares.css";

const API = "https://chatapp-system-mbzq.onrender.com";
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const TABS = [
  { id: "received", label: "For you" },
  { id: "sent", label: "Sent" },
  { id: "done", label: "Done" },
  { id: "ranks", label: "Ranks" },
];
const STATUS_LABEL = {
  pending: "New",
  accepted: "In progress",
  submitted: "Waiting for review",
  approved: "Completed",
  declined: "Skipped",
  expired: "Ran out of time",
};

function DareIcon({ name }) {
  const icons = {
    creative: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    art: <><path d="m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z" /><path d="m14.5 6.5 3 3" /></>,
    photo: <><path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></>,
    trivia: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.4 1.6c-1.1 1.1-2 1.4-2 3M12 17h.01" /></>,
    dance: <><circle cx="12" cy="5" r="2" /><path d="m10 10-4 3 3 2-2 5M14 10l4 2-2 3 3 4M10 10l2 3 2-3" /></>,
    funny: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 3 4 3 4-3 4-3M9 9h.01M15 9h.01" /></>,
    video: <><path d="M4 7h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><path d="m16 10 6-3v10l-6-3z" /></>,
    streak: <path d="M12 22c4.4 0 7-3 7-7.2 0-2.5-1.2-4.2-3.4-6.3.2 2-1 3.2-2.6 4.1.1-3.6-1.8-6.4-5.3-9.6.1 3.2-.3 4.4-1.5 6-1.7 2.2-2.2 3.7-2.2 5.8C4 18.9 7 22 12 22Z" />,
    first: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    ten: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4" /></>,
  };
  return (
    <svg className={`dare-icon dare-icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name] || icons.first}
    </svg>
  );
}

function formatLimit(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} hour`;
  return "24 hours";
}

function useCountdown(expiresAt, active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active || !expiresAt) return "";
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  if (left === 0) return "Time is up";
  const s = Math.floor(left / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}:${String(sec).padStart(2, "0")} left`;
}

function Proof({ dare, token }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    fetch(`${API}/api/dares/${dare.id}/proof`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error("no proof");
        return r.blob();
      })
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !revoked && setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [dare.id, token]);

  if (failed) return <p className="dares-muted">Could not load the proof.</p>;
  if (!url) return <p className="dares-muted">Loading proof…</p>;
  const mime = dare.proof_mime || "";
  if (mime.startsWith("image/")) return <img className="dares-proof" src={url} alt="Proof" />;
  if (mime.startsWith("video/")) return <video className="dares-proof" src={url} controls playsInline />;
  if (mime.startsWith("audio/")) return <audio className="dares-proof-audio" src={url} controls />;
  return <a href={url} download={dare.proof_name || "proof"}>Download proof</a>;
}

function DareCard({ dare, me, onOpen }) {
  const iAmRecipient = String(dare.recipient_id) === String(me);
  const other = iAmRecipient
    ? { name: dare.sender_username, avatar: dare.sender_avatar }
    : { name: dare.recipient_username, avatar: dare.recipient_avatar };
  const live = dare.status === "pending" || dare.status === "accepted";
  const countdown = useCountdown(dare.expires_at, live);
  return (
    <button type="button" className="dare-card" onClick={() => onOpen(dare)}>
      <Avatar src={other.avatar} name={other.name} className="dare-card-avatar" />
      <div className="dare-card-body">
        <p className="dare-card-who">
          {iAmRecipient ? `${other.name} dared you` : `You dared ${other.name}`}
        </p>
        <p className="dare-card-text"><DareIcon name={dare.category} />{dare.text}</p>
        <p className="dare-card-meta">
          <span className={`dare-pill dare-pill-${dare.status}`}>{STATUS_LABEL[dare.status] || dare.status}</span>
          <span>+{dare.points} pts</span>
          {live && countdown && <span className="dare-countdown">{countdown}</span>}
        </p>
      </div>
    </button>
  );
}

function DareModal({ dare, me, token, onClose, onChanged }) {
  const iAmRecipient = String(dare.recipient_id) === String(me);
  const iAmSender = String(dare.sender_id) === String(me);
  const live = dare.status === "pending" || dare.status === "accepted";
  const countdown = useCountdown(dare.expires_at, live);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef(null);
  const navigate = useNavigate();

  async function call(path, body) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/dares/${dare.id}/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Something went wrong.");
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function act(path) {
    const data = await call(path);
    if (data) {
      onChanged();
      onClose();
    }
  }

  function pickFile(event) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    if (chosen.size > MAX_PROOF_BYTES) {
      setError("That file is too big. The limit is 10 MB.");
      return;
    }
    if (!/^(image|video|audio)\//.test(chosen.type)) {
      setError("Please choose a photo, video or voice recording.");
      return;
    }
    setError("");
    setFile(chosen);
  }

  async function submitProof() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`${API}/api/dares/${dare.id}/proof`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ attachment: { file_name: file.name, data: dataUrl }, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not send proof.");
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendReport() {
    const data = await call("report", { reason });
    if (data) {
      setReportOpen(false);
      setNotice("Thanks. We will take a look.");
    }
  }

  const other = iAmRecipient ? dare.sender_username : dare.recipient_username;

  return (
    <div className="dares-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dares-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dares-close" onClick={onClose} aria-label="Close">×</button>
        <p className="dares-eyebrow">{iAmRecipient ? `From ${other}` : `To ${other}`}</p>
        <h2 className="dares-modal-text"><DareIcon name={dare.category} />{dare.text}</h2>
        <p className="dare-card-meta">
          <span className={`dare-pill dare-pill-${dare.status}`}>{STATUS_LABEL[dare.status] || dare.status}</span>
          <span>+{dare.points} pts</span>
          <span>{formatLimit(dare.time_limit_minutes)} limit</span>
          {live && countdown && <span className="dare-countdown">{countdown}</span>}
        </p>

        {dare.has_proof && (dare.status === "submitted" || dare.status === "approved") && (
          <div className="dares-proof-wrap">
            <Proof dare={dare} token={token} />
            {dare.proof_note && <p className="dares-note">“{dare.proof_note}”</p>}
          </div>
        )}

        {error && <p className="dares-error" role="alert">{error}</p>}
        {notice && <p className="dares-notice">{notice}</p>}

        {iAmRecipient && dare.status === "pending" && (
          <div className="dares-actions">
            <button type="button" className="dares-btn dares-btn-primary" disabled={busy} onClick={() => act("accept")}>Accept dare</button>
            <button type="button" className="dares-btn" disabled={busy} onClick={() => act("decline")}>Skip</button>
          </div>
        )}

        {iAmRecipient && dare.status === "accepted" && (
          <div className="dares-proof-form">
            <p className="dares-muted">Send proof that you did it: a photo, video or voice recording (up to 10 MB).</p>
            <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" hidden onChange={pickFile} />
            <button type="button" className="dares-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              {file ? `Chosen: ${file.name}` : "Choose proof"}
            </button>
            <input
              className="dares-input"
              placeholder="Add a note (optional)"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="dares-actions">
              <button type="button" className="dares-btn dares-btn-primary" disabled={!file || busy} onClick={submitProof}>
                {busy ? "Sending…" : "Send proof"}
              </button>
              <button type="button" className="dares-btn" disabled={busy} onClick={() => navigate(`/live?dare=${dare.id}&title=${encodeURIComponent(dare.text.slice(0, 100))}`)}><DareIcon name="video" />Do it live</button>
              <button type="button" className="dares-btn" disabled={busy} onClick={() => act("decline")}>Give up</button>
            </div>
          </div>
        )}

        {iAmRecipient && dare.status === "submitted" && (
          <p className="dares-muted">Proof sent. {other} will review it.</p>
        )}

        {iAmSender && dare.status === "submitted" && (
          <div className="dares-actions">
            <button type="button" className="dares-btn dares-btn-primary" disabled={busy} onClick={() => act("approve")}>
              Approve (+{dare.points} pts)
            </button>
            <button type="button" className="dares-btn" disabled={busy} onClick={() => act("redo")}>Ask for another try</button>
          </div>
        )}

        {iAmRecipient && dare.status !== "approved" && (
          <div className="dares-report">
            {!reportOpen ? (
              <button type="button" className="dares-link" onClick={() => setReportOpen(true)}>Report this dare</button>
            ) : (
              <div className="dares-proof-form">
                <input
                  className="dares-input"
                  placeholder="What is wrong with this dare?"
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="dares-actions">
                  <button type="button" className="dares-btn" disabled={busy || reason.trim().length < 3} onClick={sendReport}>Send report</button>
                  <button type="button" className="dares-btn" onClick={() => setReportOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NewDare({ token, library, onClose, onSent }) {
  const [friends, setFriends] = useState([]);
  const [friendId, setFriendId] = useState("");
  const [category, setCategory] = useState("creative");
  const [text, setText] = useState("");
  const [limit, setLimit] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/friends`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setFriends(Array.isArray(list) ? list : []))
      .catch(() => setFriends([]));
  }, [token]);

  const current = library?.categories?.find((c) => c.id === category);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/dares`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: String(friendId), text: text.trim(), category, timeLimitMinutes: limit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not send the dare.");
      onSent();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dares-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dares-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dares-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="dares-modal-text">New dare</h2>

        <p className="dares-label">Who do you want to dare?</p>
        {friends.length === 0 ? (
          <p className="dares-muted">Add some friends first. You can only dare friends.</p>
        ) : (
          <div className="dares-friends">
            {friends.map((f) => (
              <button
                type="button"
                key={f.id}
                className={`dares-friend${String(friendId) === String(f.id) ? " selected" : ""}`}
                onClick={() => setFriendId(f.id)}
              >
                <Avatar src={f.avatar} name={f.username} className="dares-friend-avatar" />
                <span>{f.username}</span>
              </button>
            ))}
          </div>
        )}

        <p className="dares-label">Category</p>
        <div className="dares-chips">
          {(library?.categories || []).map((c) => (
            <button
              type="button"
              key={c.id}
              className={`dares-chip${category === c.id ? " selected" : ""}`}
              onClick={() => setCategory(c.id)}
            >
              <DareIcon name={c.id} />{c.label} · {c.points}
            </button>
          ))}
        </div>

        <p className="dares-label">The dare</p>
        <textarea
          className="dares-input dares-textarea"
          maxLength={200}
          placeholder="Sing the chorus of your favourite song"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {current?.ideas?.length > 0 && (
          <div className="dares-ideas">
            <span className="dares-muted">Ideas:</span>
            {current.ideas.map((idea) => (
              <button type="button" key={idea} className="dares-idea" onClick={() => setText(idea)}>{idea}</button>
            ))}
          </div>
        )}

        <p className="dares-label">Time limit</p>
        <div className="dares-chips">
          {(library?.timeLimits || [10, 60, 1440]).map((m) => (
            <button type="button" key={m} className={`dares-chip${limit === m ? " selected" : ""}`} onClick={() => setLimit(m)}>
              {formatLimit(m)}
            </button>
          ))}
        </div>

        {error && <p className="dares-error" role="alert">{error}</p>}
        <div className="dares-actions">
          <button
            type="button"
            className="dares-btn dares-btn-primary"
            disabled={busy || !friendId || text.trim().length < 5}
            onClick={send}
          >
            {busy ? "Sending…" : "Send dare"}
          </button>
        </div>
        <p className="dares-muted dares-small">Keep it fun and safe. Dares that are dangerous, rude or private are blocked.</p>
      </div>
    </div>
  );
}

export default function DaresPage() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const me = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("user"))?.id; } catch { return null; }
  }, []);
  const [tab, setTab] = useState("received");
  const [list, setList] = useState([]);
  const [stats, setStats] = useState(null);
  const [ranks, setRanks] = useState([]);
  const [range, setRange] = useState("week");
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openDare, setOpenDare] = useState(null);
  const [creating, setCreating] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/dares/stats`, { headers });
      if (r.ok) setStats(await r.json());
    } catch { /* keep old stats */ }
  }, [headers]);

  const loadTab = useCallback(async () => {
    try {
      if (tab === "ranks") {
        const r = await fetch(`${API}/api/dares/leaderboard?range=${range}`, { headers });
        if (!r.ok) throw new Error("Could not load the ranks.");
        setRanks(await r.json());
      } else {
        const r = await fetch(`${API}/api/dares?box=${tab}`, { headers });
        if (!r.ok) throw new Error("Could not load dares.");
        setList(await r.json());
      }
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, range, headers]);

  const refresh = useCallback(() => {
    loadTab();
    loadStats();
  }, [loadTab, loadStats]);

  useEffect(() => {
    setLoading(true);
    loadTab();
  }, [loadTab]);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    fetch(`${API}/api/dares/library`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then(setLibrary)
      .catch(() => {});
  }, [headers]);

  // live refresh: the server rings "daresChanged"; polling is the backup
  useEffect(() => {
    const socket = io(API, { auth: { token } });
    socket.on("daresChanged", refresh);
    const id = setInterval(refresh, 30000);
    return () => {
      clearInterval(id);
      socket.disconnect();
    };
  }, [token, refresh]);

  return (
    <main className="dares-page dares-dashboard">
      <header className="dares-header">
        <div>
          <p className="dares-eyebrow">DARES</p>
          <h1>Dare your friends</h1>
        </div>
        <div className="dares-actions" style={{ marginTop: 0 }}>
          <button type="button" className="dares-btn" onClick={() => navigate("/live")}><DareIcon name="video" />Live</button>
          <button type="button" className="dares-btn dares-btn-primary" onClick={() => setCreating(true)}><svg className="dare-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New dare</button>
        </div>
      </header>

      {stats && (
        <section className="dares-stats" aria-label="Your stats">
          <div><strong>{stats.points}</strong><span>points</span></div>
          <div><strong>{stats.streak}<DareIcon name="streak" /></strong><span>day streak</span></div>
          <div><strong>{stats.completed}</strong><span>completed</span></div>
          <div><strong>{stats.successRate === null ? "–" : `${stats.successRate}%`}</strong><span>success</span></div>
        </section>
      )}

      {stats?.badges?.some((b) => b.earned) && (
        <div className="dares-badges">
          {stats.badges.filter((b) => b.earned).map((b) => (
            <span key={b.id} className="dares-badge"><DareIcon name={b.id} />{b.label}</span>
          ))}
        </div>
      )}

      <nav className="dares-tabs" aria-label="Dares sections">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={`dares-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "received" && stats?.activeForYou > 0 && <span className="dares-tab-badge">{stats.activeForYou}</span>}
            {t.id === "sent" && stats?.awaitingReview > 0 && <span className="dares-tab-badge">{stats.awaitingReview}</span>}
          </button>
        ))}
      </nav>

      {error && <p className="dares-error" role="alert">{error}</p>}

      {tab === "ranks" ? (
        <section className="dares-list">
          <div className="dares-chips">
            <button type="button" className={`dares-chip${range === "week" ? " selected" : ""}`} onClick={() => setRange("week")}>This week</button>
            <button type="button" className={`dares-chip${range === "all" ? " selected" : ""}`} onClick={() => setRange("all")}>All time</button>
          </div>
          {loading ? <p className="dares-muted">Loading…</p> : ranks.map((r) => (
            <div key={r.id} className={`dares-rank${r.isMe ? " me" : ""}`}>
              <span className="dares-rank-n">{r.rank}</span>
              <Avatar src={r.avatar} name={r.username} className="dare-card-avatar" />
              <span className="dares-rank-name">{r.isMe ? "You" : r.username}</span>
              <span className="dares-rank-pts">{r.points} pts</span>
            </div>
          ))}
        </section>
      ) : (
        <section className="dares-list">
          {loading ? (
            <p className="dares-muted">Loading…</p>
          ) : list.length === 0 ? (
            <p className="dares-empty">
              {tab === "received" ? "No dares waiting for you." : tab === "sent" ? "You have not sent any dares yet." : "Finished dares will show up here."}
            </p>
          ) : (
            list.map((d) => <DareCard key={d.id} dare={d} me={me} onOpen={setOpenDare} />)
          )}
        </section>
      )}

      {openDare && (
        <DareModal dare={openDare} me={me} token={token} onClose={() => setOpenDare(null)} onChanged={refresh} />
      )}
      {creating && (
        <NewDare token={token} library={library} onClose={() => setCreating(false)} onSent={() => { setTab("sent"); refresh(); }} />
      )}
    </main>
  );
}
