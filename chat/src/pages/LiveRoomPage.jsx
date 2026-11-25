import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { Room, RoomEvent } from "livekit-client";
import "../css/Dares.css";
import "../css/Live.css";

const API = "https://chatapp-system-mbzq.onrender.com";
const EMOJIS = ["🔥", "👏", "😂", "😮", "❤️"];

export default function LiveRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const me = useMemo(() => {
    try { return String(JSON.parse(localStorage.getItem("user"))?.id); } catch { return ""; }
  }, []);
  const videoBox = useRef(null);
  const chatEnd = useRef(null);
  const socketRef = useRef(null);
  const roomRef = useRef(null);
  const hostRef = useRef(false);
  const endedRef = useRef(false);
  const [info, setInfo] = useState(null);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState("");
  const [viewers, setViewers] = useState(0);
  const [votes, setVotes] = useState({ pass: 0, fail: 0 });
  const [myVote, setMyVote] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [floating, setFloating] = useState([]);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    function attach(track) {
      if (!videoBox.current) return;
      const el = track.attach();
      el.className = track.kind === "video" ? "live-video" : "live-audio";
      if (track.kind === "video") el.playsInline = true;
      videoBox.current.appendChild(el);
    }

    async function start() {
      try {
        const infoRes = await fetch(`${API}/api/live/${id}`, { headers });
        const infoData = await infoRes.json().catch(() => ({}));
        if (!infoRes.ok) throw new Error(infoData.message || "Live not found.");
        if (cancelled) return;
        setInfo(infoData);
        if (infoData.status !== "live") { setEnded(true); return; }

        const tokRes = await fetch(`${API}/api/live/${id}/token`, { method: "POST", headers });
        const tok = await tokRes.json().catch(() => ({}));
        if (!tokRes.ok) throw new Error(tok.message || "Could not join the live.");
        if (cancelled) return;
        setRole(tok.role);
        hostRef.current = tok.role === "host";

        const socket = io(API, { auth: { token } });
        socketRef.current = socket;
        socket.on("connect", () => {
          socket.emit("live:join", { roomId: id }, (ack) => {
            if (ack?.ok) { setViewers(ack.count || 0); setVotes({ pass: ack.pass || 0, fail: ack.fail || 0 }); }
          });
        });
        socket.on("live:viewers", (d) => String(d.roomId) === String(id) && setViewers(d.count));
        socket.on("live:votes", (d) => String(d.roomId) === String(id) && setVotes({ pass: d.pass, fail: d.fail }));
        socket.on("live:chat", (d) => String(d.roomId) === String(id) && setMessages((m) => [...m.slice(-80), d]));
        socket.on("live:reaction", (d) => {
          if (String(d.roomId) !== String(id)) return;
          const key = Math.random();
          setFloating((f) => [...f, { key, emoji: d.emoji, left: 10 + Math.random() * 70 }]);
          setTimeout(() => setFloating((f) => f.filter((x) => x.key !== key)), 2500);
        });
        socket.on("live:ended", () => setEnded(true));

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        room.on(RoomEvent.TrackSubscribed, (track) => attach(track));
        room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
        room.on(RoomEvent.Disconnected, () => setStatus("Disconnected"));
        await room.connect(tok.url, tok.token);
        if (cancelled) { room.disconnect(); return; }

        if (tok.role === "host") {
          await room.localParticipant.setCameraEnabled(true);
          await room.localParticipant.setMicrophoneEnabled(true);
          room.localParticipant.trackPublications.forEach((pub) => {
            if (pub.track && pub.kind === "video") {
              const el = pub.track.attach();
              el.className = "live-video live-video-self";
              el.muted = true;
              videoBox.current?.appendChild(el);
            }
          });
          setStatus("You are live");
        } else {
          room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => pub.track && attach(pub.track)));
          setStatus("Watching");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.name === "NotAllowedError" ? "Please allow camera and microphone to go live." : err.message);
        }
      }
    }
    start();

    return () => {
      cancelled = true;
      // the host leaving the page ends the live, so it does not stay in "Live now"
      if (hostRef.current && !endedRef.current) {
        endedRef.current = true;
        fetch(`${API}/api/live/${id}/end`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
      }
      socketRef.current?.emit("live:leave", { roomId: id });
      socketRef.current?.disconnect();
      roomRef.current?.disconnect();
    };
  }, [id, token]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [messages]);

  function sendChat(e) {
    e.preventDefault();
    if (!text.trim()) return;
    socketRef.current?.emit("live:chat", { roomId: id, text });
    setText("");
  }

  function vote(v) {
    setMyVote(v);
    socketRef.current?.emit("live:vote", { roomId: id, vote: v });
  }

  async function endLive() {
    endedRef.current = true;
    await fetch(`${API}/api/live/${id}/end`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    navigate(info?.dare_id ? "/dares" : "/live");
  }

  const isHost = role === "host" || (info && String(info.host_id) === me);

  if (ended) {
    return (
      <main className="dares-page live-page">
        <p className="dares-empty">This live has ended.</p>
        <div className="dares-actions" style={{ justifyContent: "center" }}>
          <button type="button" className="dares-btn dares-btn-primary" onClick={() => navigate("/live")}>Back to Live</button>
        </div>
      </main>
    );
  }

  return (
    <main className="dares-page live-page live-room">
      <header className="live-room-head">
        <button type="button" className="dares-btn" onClick={() => navigate("/live")}>←</button>
        <div className="live-room-title">
          <strong>{info?.title || "Live"}</strong>
          <span className="dares-muted">{info?.host_username} · {viewers} watching · {status}</span>
        </div>
        {isHost && <button type="button" className="dares-btn live-end" onClick={endLive}>End</button>}
      </header>

      {error && <p className="dares-error" role="alert">{error}</p>}

      <div className="live-stage">
        <div ref={videoBox} className="live-video-box" />
        {floating.map((f) => (
          <span key={f.key} className="live-float" style={{ left: `${f.left}%` }}>{f.emoji}</span>
        ))}
        <span className="live-badge live-badge-corner">LIVE</span>
      </div>

      {info?.dare_id && (
        <div className="live-votes">
          <div className="live-votebar">
            <div className="live-votebar-pass" style={{ width: `${votes.pass + votes.fail ? (votes.pass / (votes.pass + votes.fail)) * 100 : 50}%` }} />
          </div>
          <div className="live-votecount"><span>✅ Pass {votes.pass}</span><span>Fail {votes.fail} ❌</span></div>
          {!isHost && (
            <div className="dares-actions">
              <button type="button" className={`dares-btn${myVote === "pass" ? " dares-btn-primary" : ""}`} onClick={() => vote("pass")}>Pass</button>
              <button type="button" className={`dares-btn${myVote === "fail" ? " dares-btn-primary" : ""}`} onClick={() => vote("fail")}>Fail</button>
            </div>
          )}
        </div>
      )}

      <div className="live-reactions">
        {EMOJIS.map((e) => (
          <button type="button" key={e} className="dares-chip" onClick={() => socketRef.current?.emit("live:reaction", { roomId: id, emoji: e })}>{e}</button>
        ))}
      </div>

      <section className="live-chat" aria-label="Live chat">
        {messages.map((m, i) => (
          <p key={`${m.at}-${i}`}><strong>{m.userId === me ? "You" : m.username}</strong> {m.text}</p>
        ))}
        <div ref={chatEnd} />
      </section>
      <form className="live-chatform" onSubmit={sendChat}>
        <input className="dares-input" placeholder="Say something nice…" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="dares-btn dares-btn-primary">Send</button>
      </form>
    </main>
  );
}
