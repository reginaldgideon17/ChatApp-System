import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { Room, RoomEvent } from "livekit-client";
import Avatar from "../components/Avatar";
import ShareWithFriendsDialog from "../components/ShareWithFriendsDialog";
import "../css/Dares.css";
import "../css/Live.css";

const API = "https://chatapp-system-mbzq.onrender.com";
const REACTIONS = [
  { id: "heart", label: "Like" },
  { id: "clap", label: "Applause" },
  { id: "fire", label: "Fire" },
  { id: "laugh", label: "Laugh" },
  { id: "wow", label: "Wow" },
];

function ReactionIcon({ name }) {
  const paths = {
    heart: <path d="M20.8 8.7c0 4.3-8.8 10-8.8 10s-8.8-5.7-8.8-10A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.5Z" />,
    clap: <><path d="m8 12-1.6-1.6a1.5 1.5 0 0 0-2.1 2.1l4.8 5a4 4 0 0 0 2.9 1.2h3a4 4 0 0 0 4-4v-3a1.5 1.5 0 0 0-3 0V9a1.5 1.5 0 0 0-3 0V7a1.5 1.5 0 0 0-3 0v5" /><path d="M8 12V6a1.5 1.5 0 0 0-3 0v4" /></>,
    fire: <path d="M12 22c4.4 0 7-3 7-7.2 0-2.5-1.2-4.2-3.4-6.3.2 2-1 3.2-2.6 4.1.1-3.6-1.8-6.4-5.3-9.6.1 3.2-.3 4.4-1.5 6-1.7 2.2-2.2 3.7-2.2 5.8C4 18.9 7 22 12 22Z" />,
    laugh: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 3 4 3 4-3 4-3M9 9h.01M15 9h.01" /></>,
    wow: <><circle cx="12" cy="12" r="9" /><path d="M9 9h.01M15 9h.01" /><ellipse cx="12" cy="15" rx="1.5" ry="2" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.heart}
    </svg>
  );
}

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
  const floatingTimers = useRef(new Map());
  const [info, setInfo] = useState(null);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [accessStatus, setAccessStatus] = useState("checking");
  const [accessVersion, setAccessVersion] = useState(0);
  const [error, setError] = useState("");
  const [viewers, setViewers] = useState(0);
  const [votes, setVotes] = useState({ pass: 0, fail: 0 });
  const [myVote, setMyVote] = useState("");
  const [joinRequests, setJoinRequests] = useState([]);
  const [requestBusy, setRequestBusy] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [floating, setFloating] = useState([]);
  const [ended, setEnded] = useState(false);
  const [sharing, setSharing] = useState(false);

  const addFloating = useCallback((item) => {
    const key = `${Date.now()}-${Math.random()}`;
    setFloating((current) => [...current, { ...item, key }]);
    const timer = window.setTimeout(() => {
      setFloating((current) => current.filter((entry) => entry.key !== key));
      floatingTimers.current.delete(key);
    }, 5000);
    floatingTimers.current.set(key, timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    hostRef.current = false;
    endedRef.current = false;

    const socket = io(API, { auth: { token } });
    socketRef.current = socket;
    socket.on("live:access", (event) => {
      if (String(event.roomId) !== String(id)) return;
      setAccessStatus(event.status);
      if (event.status === "accepted") setAccessVersion((version) => version + 1);
    });
    socket.on("live:join-request", (request) => {
      if (String(request.roomId) !== String(id)) return;
      setJoinRequests((current) => current.some((item) => String(item.user_id) === String(request.userId))
        ? current
        : [...current, {
            request_id: request.requestId,
            user_id: request.userId,
            username: request.username,
            avatar: request.avatar,
          }]);
    });
    socket.on("live:viewers", (event) => String(event.roomId) === String(id) && setViewers(event.count));
    socket.on("live:votes", (event) => String(event.roomId) === String(id) && setVotes({ pass: event.pass, fail: event.fail }));
    socket.on("live:chat", (event) => {
      if (String(event.roomId) !== String(id)) return;
      setMessages((current) => [...current.slice(-80), event]);
      addFloating({
        kind: "comment",
        username: String(event.userId) === me ? "You" : event.username,
        text: event.text,
        left: 7 + Math.random() * 28,
      });
    });
    socket.on("live:reaction", (event) => {
      if (String(event.roomId) !== String(id)) return;
      addFloating({ kind: "reaction", reaction: event.reaction || "heart", left: 10 + Math.random() * 70 });
    });
    socket.on("live:ended", () => setEnded(true));

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
        const isRoomHost = String(infoData.host_id) === me;
        if (infoData.visibility === "private" && !infoData.can_watch && !isRoomHost) {
          setAccessStatus(infoData.request_status || "none");
          setStatus("Waiting for approval");
          return;
        }
        setAccessStatus("allowed");

        if (isRoomHost && infoData.visibility === "private") {
          const requestsResponse = await fetch(`${API}/api/live/${id}/requests`, { headers });
          const requestsData = await requestsResponse.json().catch(() => []);
          if (!requestsResponse.ok) throw new Error(requestsData.message || "Could not load join requests.");
          if (!cancelled) setJoinRequests(requestsData);
        }

        const tokRes = await fetch(`${API}/api/live/${id}/token`, { method: "POST", headers });
        const tok = await tokRes.json().catch(() => ({}));
        if (!tokRes.ok) throw new Error(tok.message || "Could not join the live.");
        if (cancelled) return;
        setRole(tok.role);
        hostRef.current = tok.role === "host";

        const joinSocketRoom = () => {
          socket.emit("live:join", { roomId: id }, (ack) => {
            if (ack?.ok) {
              setViewers(ack.count || 0);
              setVotes({ pass: ack.pass || 0, fail: ack.fail || 0 });
            } else {
              setError("You are not allowed to join this live.");
            }
          });
        };
        if (socket.connected) joinSocketRoom();
        else socket.once("connect", joinSocketRoom);

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
  }, [accessVersion, addFloating, id, me, token]);

  useEffect(() => () => {
    floatingTimers.current.forEach((timer) => window.clearTimeout(timer));
    floatingTimers.current.clear();
  }, []);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [messages]);

  function sendChat(e) {
    e.preventDefault();
    if (!text.trim()) return;
    socketRef.current?.emit("live:chat", { roomId: id, text });
    setText("");
  }

  async function requestAccess() {
    setRequestBusy("self");
    setError("");
    try {
      const response = await fetch(`${API}/api/live/${id}/requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not request to join this live.");
      setAccessStatus(data.status);
      if (data.status === "accepted") setAccessVersion((version) => version + 1);
    } catch (requestError) {
      setError(requestError.message || "Could not request to join this live.");
    } finally {
      setRequestBusy("");
    }
  }

  async function respondToRequest(userId, status) {
    setRequestBusy(String(userId));
    setError("");
    try {
      const response = await fetch(`${API}/api/live/${id}/requests/${userId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not update the join request.");
      setJoinRequests((current) => current.filter((request) => String(request.user_id) !== String(userId)));
    } catch (requestError) {
      setError(requestError.message || "Could not update the join request.");
    } finally {
      setRequestBusy("");
    }
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
  const needsPrivateApproval = info?.visibility === "private"
    && !isHost
    && !info.can_watch
    && accessStatus !== "accepted";

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

  if (needsPrivateApproval) {
    const requestPending = accessStatus === "pending";
    return (
      <main className="dares-page live-page live-room live-access-page">
        <header className="live-room-head">
          <button type="button" className="dares-btn live-back-button" onClick={() => navigate("/live")} aria-label="Back to live rooms">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
          </button>
          <div className="live-room-title">
            <strong>{info.title}</strong>
            <span className="dares-muted">{info.host_username} · Private live</span>
          </div>
          <button type="button" className="dares-btn live-share-action" onClick={() => setSharing(true)}>Share</button>
        </header>
        <section className="live-access-card">
          <span className="live-access-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>
          </span>
          <p className="dares-eyebrow">PRIVATE LIVE</p>
          <h1>Ask to join</h1>
          <p className="dares-muted">
            {requestPending
              ? "Your request is with the host. You can join as soon as they approve it."
              : accessStatus === "declined"
                ? "The host declined your last request. You can ask again."
                : "This room is private. Send a request and wait for the host to let you in."}
          </p>
          {error && <p className="dares-error" role="alert">{error}</p>}
          <button
            type="button"
            className="dares-btn dares-btn-primary"
            onClick={requestAccess}
            disabled={requestBusy === "self" || requestPending}
          >
            {requestBusy === "self" ? "Sending request…" : requestPending ? "Request sent" : accessStatus === "declined" ? "Request again" : "Request to join"}
          </button>
        </section>
        {sharing && (
          <ShareWithFriendsDialog
            token={token}
            title="Share this live"
            description={`Send ${info.host_username}'s live to your friends.`}
            message={`Join ${info.host_username}'s live "${info.title}": ${window.location.origin}/live/${id}`}
            onClose={() => setSharing(false)}
          />
        )}
      </main>
    );
  }

  return (
    <main className="dares-page live-page live-room">
      <header className="live-room-head">
        <button type="button" className="dares-btn live-back-button" onClick={() => navigate("/live")} aria-label="Back to live rooms">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
        </button>
        <div className="live-room-title">
          <strong>{info?.title || "Live"}</strong>
          <span className="dares-muted">{info?.host_username} · {viewers} watching · {status}</span>
        </div>
        <button type="button" className="dares-btn live-share-action" onClick={() => setSharing(true)}>Share</button>
        {isHost && <button type="button" className="dares-btn live-end" onClick={endLive}>End</button>}
      </header>

      {error && <p className="dares-error" role="alert">{error}</p>}

      {isHost && info?.visibility === "private" && (
        <section className="live-requests" aria-label="Private live join requests">
          <header><h2>Join requests</h2><span>{joinRequests.length}</span></header>
          {joinRequests.length === 0 ? (
            <p className="dares-muted">No one is waiting to join.</p>
          ) : joinRequests.map((request) => (
            <div className="live-request-row" key={request.request_id || request.user_id}>
              <Avatar src={request.avatar} name={request.username} className="live-request-avatar" />
              <strong>{request.username}</strong>
              <button type="button" className="live-request-accept" disabled={Boolean(requestBusy)} onClick={() => respondToRequest(request.user_id, "accepted")}>
                {requestBusy === String(request.user_id) ? "…" : "Accept"}
              </button>
              <button type="button" className="live-request-decline" disabled={Boolean(requestBusy)} onClick={() => respondToRequest(request.user_id, "declined")}>Decline</button>
            </div>
          ))}
        </section>
      )}

      <div className="live-stage">
        <div ref={videoBox} className="live-video-box" />
        {floating.map((f) => (
          f.kind === "comment" ? (
            <div key={f.key} className="live-floating-comment" style={{ left: `${f.left}%` }} aria-hidden="true">
              <strong>{f.username}</strong> {f.text}
            </div>
          ) : (
            <span key={f.key} className={`live-float live-float-${f.reaction}`} style={{ left: `${f.left}%` }} aria-hidden="true">
              <ReactionIcon name={f.reaction} />
            </span>
          )
        ))}
        <span className="live-badge live-badge-corner">LIVE</span>
      </div>

      {info?.dare_id && (
        <div className="live-votes">
          <div className="live-votebar">
            <div className="live-votebar-pass" style={{ width: `${votes.pass + votes.fail ? (votes.pass / (votes.pass + votes.fail)) * 100 : 50}%` }} />
          </div>
          <div className="live-votecount">
            <span className="live-vote-pass">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="m6 10 2.5 2.5L14 7" /></svg>
              Pass {votes.pass}
            </span>
            <span className="live-vote-fail">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="m7 7 6 6m0-6-6 6" /></svg>
              Fail {votes.fail}
            </span>
          </div>
          {!isHost && (
            <div className="dares-actions">
              <button type="button" className={`dares-btn${myVote === "pass" ? " dares-btn-primary" : ""}`} onClick={() => vote("pass")}>Pass</button>
              <button type="button" className={`dares-btn${myVote === "fail" ? " dares-btn-primary" : ""}`} onClick={() => vote("fail")}>Fail</button>
            </div>
          )}
        </div>
      )}

      <div className="live-reactions">
        {REACTIONS.map((reaction) => (
          <button
            type="button"
            key={reaction.id}
            className={`live-reaction-button${reaction.id === "heart" ? " live-reaction-like" : ""}`}
            aria-label={`Send ${reaction.label.toLowerCase()} reaction`}
            title={reaction.label}
            onClick={() => socketRef.current?.emit("live:reaction", { roomId: id, reaction: reaction.id })}
          >
            <ReactionIcon name={reaction.id} />
            {reaction.id === "heart" && <span>Like</span>}
          </button>
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
      {sharing && (
        <ShareWithFriendsDialog
          token={token}
          title="Share this live"
          description={`Send ${info?.host_username || "this host"}'s live to your friends.`}
          message={`Join ${info?.host_username || "this host"}'s live "${info?.title || "Live"}": ${window.location.origin}/live/${id}`}
          onClose={() => setSharing(false)}
        />
      )}
    </main>
  );
}
