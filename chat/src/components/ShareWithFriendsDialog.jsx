import { useEffect, useMemo, useState } from "react";
import Avatar from "./Avatar";
import "../css/ShareDialog.css";

const API = "https://chatapp-system-mbzq.onrender.com";

export default function ShareWithFriendsDialog({ token, title, description, message, onClose }) {
  const [friends, setFriends] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    let active = true;

    async function loadFriends() {
      try {
        const response = await fetch(`${API}/api/friends`, { headers });
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.message || "Could not load your friends.");
        if (!Array.isArray(data)) throw new Error("The friends list could not be loaded.");
        if (active) setFriends(data);
      } catch (loadError) {
        if (active) setError(loadError.message || "Could not load your friends.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadFriends();
    return () => { active = false; };
  }, [headers]);

  function toggleFriend(friendId) {
    setSelectedIds((current) => current.includes(String(friendId))
      ? current.filter((id) => id !== String(friendId))
      : [...current, String(friendId)]);
    setError("");
    setNotice("");
  }

  async function shareWithSelected(event) {
    event.preventDefault();
    const recipients = friends.filter((friend) => selectedIds.includes(String(friend.id)));
    if (recipients.length === 0 || sending) return;

    setSending(true);
    setError("");
    setNotice("");
    const results = await Promise.all(recipients.map(async (friend) => {
      try {
        const conversationResponse = await fetch(`${API}/api/conversations`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ otherUserId: friend.id }),
        });
        const conversation = await conversationResponse.json().catch(() => ({}));
        if (!conversationResponse.ok) {
          throw new Error(conversation.message || "Could not open a conversation.");
        }

        const messageResponse = await fetch(`${API}/api/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ content: message }),
        });
        const result = await messageResponse.json().catch(() => ({}));
        if (!messageResponse.ok) {
          throw new Error(result.message || "Could not send the share.");
        }
        return { friend, ok: true };
      } catch (shareError) {
        return { friend, ok: false, error: shareError.message };
      }
    }));

    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);
    if (successes.length > 0) {
      setNotice(`Shared with ${successes.length} ${successes.length === 1 ? "friend" : "friends"}.`);
      setSelectedIds((current) => current.filter((id) => !successes.some((result) => String(result.friend.id) === id)));
    }
    if (failures.length > 0) {
      setError(`Could not share with ${failures.map((result) => result.friend.username).join(", ")}. Please try again.`);
    }
    setSending(false);
  }

  const filteredFriends = friends.filter((friend) =>
    friend.username.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="share-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !sending) onClose();
    }}>
      <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
        <header className="share-dialog-header">
          <div>
            <h2 id="share-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="share-dialog-close" onClick={onClose} disabled={sending} aria-label="Close share dialog">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <form onSubmit={shareWithSelected}>
          <label className="share-dialog-search">
            <span className="visually-hidden">Search friends</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search friends" />
          </label>

          <div className="share-dialog-list">
            {loading ? (
              <p className="share-dialog-empty">Loading friends…</p>
            ) : filteredFriends.length === 0 ? (
              <p className="share-dialog-empty">
                {friends.length === 0 ? "You don't have any friends to share with yet." : "No friends match that search."}
              </p>
            ) : filteredFriends.map((friend) => {
              const selected = selectedIds.includes(String(friend.id));
              return (
                <button
                  type="button"
                  key={friend.id}
                  className={`share-dialog-friend${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => toggleFriend(friend.id)}
                >
                  <Avatar src={friend.avatar} name={friend.username} className="share-dialog-avatar" />
                  <strong>{friend.username}</strong>
                  <span className="share-dialog-check" aria-hidden="true">
                    {selected && <svg viewBox="0 0 16 16"><path d="m3 8 3.2 3.2L13 4.5" /></svg>}
                  </span>
                </button>
              );
            })}
          </div>

          {error && <p className="share-dialog-error" role="alert">{error}</p>}
          {notice && <p className="share-dialog-notice" role="status">{notice}</p>}
          <footer className="share-dialog-footer">
            <span>{selectedIds.length} selected</span>
            <button type="submit" className="share-dialog-submit" disabled={sending || loading || selectedIds.length === 0}>
              {sending ? "Sharing…" : "Share"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
