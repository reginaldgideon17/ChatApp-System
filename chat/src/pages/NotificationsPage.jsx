import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { io } from "socket.io-client";
import Avatar from "../components/Avatar";
import "../css/Notifications.css";

function describeNotification(type) {
  if (type === "friend_request") return "sent you a friend request.";
  if (type === "like") return "liked your post.";
  if (type === "comment") return "commented on your post.";
  if (type === "live") return "started a live.";
  if (type === "live_request") return "asked to join your private live.";
  if (type === "live_access_accepted") return "accepted your request to join a live.";
  if (type === "live_access_declined") return "declined your request to join a live.";
  return "interacted with you.";
}

function formatNotificationTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const { refreshUnreadCounts } = useOutletContext();

  function goBack() {
    const historyIndex = window.history.state?.idx;
    navigate(Number.isInteger(historyIndex) && historyIndex > 0 ? -1 : "/feed");
  }

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("https://chatapp-system-mbzq.onrender.com/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Could not load notifications.");
      setNotifications(await response.json());
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const socket = io("https://chatapp-system-mbzq.onrender.com", { auth: { token } });
    socket.on("newNotification", fetchNotifications);
    return () => socket.disconnect();
  }, [token, fetchNotifications]);

  async function markAllRead() {
    setMarkingRead(true);
    setError("");
    try {
      const response = await fetch("https://chatapp-system-mbzq.onrender.com/api/notifications/read", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Could not mark notifications as read.");
      setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
      await refreshUnreadCounts();
    } catch (markError) {
      setError(markError.message);
    } finally {
      setMarkingRead(false);
    }
  }

  async function openNotification(notification) {
    if (!notification.read) {
      try {
        const response = await fetch(
          `https://chatapp-system-mbzq.onrender.com/api/notifications/${notification.id}/read`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!response.ok) throw new Error("Could not mark notification as read.");
        setNotifications((current) =>
          current.map((item) => item.id === notification.id ? { ...item, read: true } : item)
        );
        await refreshUnreadCounts();
      } catch (openError) {
        setError(openError.message);
      }
    }

    if (notification.type === "friend_request") {
      navigate("/requests");
    } else if (notification.live_id) {
      navigate(`/live/${notification.live_id}`);
    } else if (notification.post_id) {
      navigate(`/feed#post-${notification.post_id}`);
    } else {
      navigate("/feed");
    }
  }

  const hasUnread = notifications.some((notification) => !notification.read);

  return (
    <main className="notifications-page">
      <header className="notifications-header">
        <button type="button" className="notifications-back" onClick={goBack} aria-label="Go back">
          ‹
        </button>
        <div className="notifications-heading">
          <h1>Notifications</h1>
          <p className="notifications-subtitle">Friend requests, live rooms, likes, and comments in one place.</p>
        </div>
        <button
          className="notifications-read-button"
          type="button"
          onClick={markAllRead}
          disabled={!hasUnread || markingRead}
        >
          {markingRead ? "Updating..." : "Mark all read"}
        </button>
      </header>

      {error && <p className="notifications-error" role="alert">{error}</p>}

      <section className="notifications-list" aria-label="Recent notifications">
        {loading ? (
          <p className="notifications-empty">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <p className="notifications-empty">You’re all caught up.</p>
        ) : (
          notifications.map((notification) => (
            <button
              type="button"
              className={`notification-row${notification.read ? "" : " notification-unread"}`}
              key={notification.id}
              onClick={() => openNotification(notification)}
            >
              <Avatar
                src={notification.actor_avatar}
                name={notification.actor_username}
                className="notification-avatar"
              />
              <p className="notification-message">
                <strong>{notification.actor_username}</strong> {describeNotification(notification.type)}
              </p>
              <time className="notification-time" dateTime={notification.created_at}>
                {formatNotificationTime(notification.created_at)}
              </time>
              {!notification.read && <span className="notification-unread-dot" aria-label="Unread" />}
            </button>
          ))
        )}
      </section>
    </main>
  );
}