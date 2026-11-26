import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { resizeCoverImage, resizeImage } from "../resizeImage";
import Avatar from "../components/Avatar";
import { getTextPostStyle } from "../textPostStyles";
import "../css/Profile.css";

const API_URL = "https://chatapp-system-mbzq.onrender.com";

const profileIcons = {
  camera: (
    <>
      <path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  friends: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4" />
    </>
  ),
  posts: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.2-.1a1.7 1.7 0 0 0-1.9.2 1.7 1.7 0 0 0-.8 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.2l-.2.1-1.6-2.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6v-3.2h.2a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.2-1.8l-.1-.2 2.8-1.6.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V6h3.2v.2a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.8-.2l.2-.1 1.6 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3.2h-.2a1.7 1.7 0 0 0-1.5-1.5Z" />
    </>
  ),
  logout: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  streak: (
    <>
      <path d="M12 22c4.4 0 7-3 7-7.2 0-2.5-1.2-4.2-3.4-6.3.2 2-1 3.2-2.6 4.1.1-3.6-1.8-6.4-5.3-9.6.1 3.2-.3 4.4-1.5 6-1.7 2.2-2.2 3.7-2.2 5.8C4 18.9 7 22 12 22Z" />
      <path d="M12 18a2 2 0 0 0 2-2c0-1-.5-1.8-1.5-2.8-.2 1-.7 1.3-1.4 1.8-.7.5-1.1 1-1.1 1.7a2 2 0 0 0 2 1.3Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

function ProfileIcon({ name }) {
  return (
    <svg
      className={`profile-icon profile-icon-${name}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {profileIcons[name]}
    </svg>
  );
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ProfilePage() {
  const { handleLogout } = useOutletContext();
  const navigate = useNavigate();
  const { userId } = useParams();
  const [currentUser, setCurrentUser] = useState(() => JSON.parse(localStorage.getItem("user") || "null"));
  const [profileUser, setProfileUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [dareStats, setDareStats] = useState(null);
  const [dareStatsError, setDareStatsError] = useState("");
  const [friendCount, setFriendCount] = useState(0);
  const [friends, setFriends] = useState([]);
  const [friendsAvailable, setFriendsAvailable] = useState(true);
  const [isFriend, setIsFriend] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [removingFriendId, setRemovingFriendId] = useState(null);
  const [activeTab, setActiveTab] = useState("posts");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [bioEditing, setBioEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [bioSaving, setBioSaving] = useState(false);
  const fileInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const token = localStorage.getItem("token");
  const viewedUserId = userId || currentUser?.id;
  const isOwnProfile = Number(viewedUserId) === Number(currentUser?.id);

  const fetchProfileContent = useCallback(async () => {
    setLoading(true);
    setError("");
    setProfileUser(isOwnProfile ? currentUser : null);
    setPosts([]);
    setStatuses([]);
    setDareStats(null);
    setDareStatsError("");
    setFriendCount(0);
    setFriends([]);
    setFriendsAvailable(true);
    setIsFriend(false);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      if (!isOwnProfile) {
        const response = await fetch(`${API_URL}/api/users/${viewedUserId}/profile`, { headers });
        if (response.status === 404) {
          // Support deployments where the profile endpoint has not been deployed yet.
          const [usersResponse, postsResponse, statusesResponse] = await Promise.all([
            fetch(`${API_URL}/api/users`, { headers }),
            fetch(`${API_URL}/api/posts`, { headers }),
            fetch(`${API_URL}/api/statuses`, { headers }),
          ]);
          if (!usersResponse.ok || !postsResponse.ok || !statusesResponse.ok) {
            throw new Error("Could not load this profile.");
          }
          const [users, allPosts, allStatuses] = await Promise.all([
            usersResponse.json(),
            postsResponse.json(),
            statusesResponse.json(),
          ]);
          const selectedUser = users.find((item) => Number(item.id) === Number(viewedUserId));
          if (!selectedUser) throw new Error("This profile is unavailable.");
          const [selectedFriendsResponse, ownFriendsResponse] = await Promise.all([
            fetch(`${API_URL}/api/users/${viewedUserId}/friends`, { headers }),
            fetch(`${API_URL}/api/friends`, { headers }),
          ]);
          if (selectedFriendsResponse.ok) {
            const selectedFriends = await selectedFriendsResponse.json();
            setFriends(selectedFriends);
            setFriendCount(selectedFriends.length);
          } else {
            setFriendsAvailable(false);
          }
          if (ownFriendsResponse.ok) {
            const ownFriends = await ownFriendsResponse.json();
            setIsFriend(ownFriends.some((friend) => Number(friend.id) === Number(viewedUserId)));
          }
          setProfileUser(selectedUser);
          setPosts(allPosts.filter((post) => Number(post.user_id) === Number(viewedUserId)));
          setStatuses(allStatuses.filter((status) => Number(status.user_id) === Number(viewedUserId)));
          return;
        }
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message || "Could not load this profile.");
        if (!data?.user || !Array.isArray(data.posts) || !Array.isArray(data.statuses)) {
          throw new Error("The selected user's profile could not be loaded.");
        }
        setProfileUser(data.user);
        setPosts(data.posts);
        setStatuses(data.statuses);
        setFriends(Array.isArray(data.friends) ? data.friends : []);
        setFriendsAvailable(Array.isArray(data.friends));
        setFriendCount(Array.isArray(data.friends) ? data.friends.length : Number(data.friendCount) || 0);
        setIsFriend(true);
        return;
      }

      setProfileUser(currentUser);
      const [postsResponse, statusesResponse, friendsResponse] = await Promise.all([
        fetch(`${API_URL}/api/posts`, { headers }),
        fetch(`${API_URL}/api/statuses`, { headers }),
        fetch(`${API_URL}/api/friends`, { headers }),
      ]);
      if (!postsResponse.ok || !statusesResponse.ok || !friendsResponse.ok) {
        throw new Error("Could not load your profile. Please try again.");
      }
      const [allPosts, allStatuses, friends] = await Promise.all([
        postsResponse.json(),
        statusesResponse.json(),
        friendsResponse.json(),
      ]);
      setPosts(allPosts.filter((post) => Number(post.user_id) === Number(currentUser?.id)));
      setStatuses(allStatuses.filter((status) => Number(status.user_id) === Number(currentUser?.id)));
      setFriendCount(friends.length);
      setFriends(friends);
      setIsFriend(false);
    } catch (loadError) {
      setError(loadError.message || "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, isOwnProfile, token, viewedUserId]);

  useEffect(() => {
    fetchProfileContent();
  }, [fetchProfileContent]);

  useEffect(() => {
    if (!isOwnProfile) return undefined;

    let active = true;
    fetch(`${API_URL}/api/dares/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load dare statistics.");
        return response.json();
      })
      .then((stats) => {
        if (active) setDareStats(stats);
      })
      .catch((statsError) => {
        if (active) {
          setDareStats(null);
          setDareStatsError(statsError.message || "Could not load dare statistics.");
        }
      });

    return () => {
      active = false;
    };
  }, [isOwnProfile, token]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setUploading(true);
    try {
      const resized = await resizeImage(file, 256);
      const response = await fetch(`${API_URL}/api/users/avatar`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ avatar: resized }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to update profile photo.");

      const updatedUser = { ...currentUser, avatar: resized };
      localStorage.setItem("user", JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setProfileUser(updatedUser);
    } catch (uploadError) {
      setError(uploadError.message || "Failed to update profile photo.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleCoverChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for your cover.");
      event.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Cover images must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }

    setCoverUploading(true);
    try {
      const coverImage = await resizeCoverImage(file);
      const response = await fetch(`${API_URL}/api/users/cover`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ coverImage }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to update cover image.");

      const updatedUser = { ...currentUser, cover_image: coverImage };
      localStorage.setItem("user", JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setProfileUser(updatedUser);
    } catch (uploadError) {
      setError(uploadError.message || "Failed to update cover image.");
    } finally {
      setCoverUploading(false);
      event.target.value = "";
    }
  }

  async function handleSaveBio(event) {
    event.preventDefault();
    const bio = bioDraft.trim();
    setError("");
    setBioSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/users/bio`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bio }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to update bio.");

      const savedBio = data.bio || "";
      const updatedUser = { ...currentUser, bio: savedBio };
      localStorage.setItem("user", JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setProfileUser(updatedUser);
      setBioDraft(savedBio);
      setBioEditing(false);
    } catch (saveError) {
      setError(saveError.message || "Failed to update bio.");
    } finally {
      setBioSaving(false);
    }
  }

  async function deletePost(postId) {
    if (!isOwnProfile) return;
    if (!window.confirm("Delete this post? This action cannot be undone.")) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/posts/${postId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to delete post.");
      setPosts((current) => current.filter((post) => post.id !== postId));
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete post.");
    }
  }

  async function deleteStatus(statusId) {
    if (!isOwnProfile) return;
    if (!window.confirm("Delete this status? This action cannot be undone.")) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/statuses/${statusId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to delete status.");
      setStatuses((current) => current.filter((status) => status.id !== statusId));
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete status.");
    }
  }

  async function messageFriend(friend) {
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ otherUserId: friend.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not open this conversation.");
      navigate(`/chat/${data.id}`);
    } catch (messageError) {
      setError(messageError.message || "Could not open this conversation.");
    }
  }

  async function removeFriend(friend) {
    if (!window.confirm(`Remove ${friend.username} from your friends?`)) return;
    setError("");
    setRemovingFriendId(friend.id);
    try {
      const response = await fetch(`${API_URL}/api/friends/${friend.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not remove this friend.");
      setFriends((current) => current.filter((item) => Number(item.id) !== Number(friend.id)));
      setFriendCount((count) => Math.max(0, count - 1));
    } catch (removeError) {
      setError(removeError.message || "Could not remove this friend.");
    } finally {
      setRemovingFriendId(null);
    }
  }

  async function removeProfileFriend() {
    if (!profileUser || isOwnProfile) return;
    if (!window.confirm(`Remove ${profileUser.username} from your friends?`)) return;
    setError("");
    setRemovingFriendId(profileUser.id);
    try {
      const response = await fetch(`${API_URL}/api/friends/${profileUser.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not remove this friend.");
      setIsFriend(false);
      setFriends((current) => current.filter((friend) => Number(friend.id) !== Number(currentUser?.id)));
      setFriendCount((count) => Math.max(0, Number(count) - 1));
    } catch (removeError) {
      setError(removeError.message || "Could not remove this friend.");
    } finally {
      setRemovingFriendId(null);
    }
  }

  return (
    <main className="profile-page">
      <div className="profile-shell">
        <section className="profile-card" aria-label={isOwnProfile ? "Your profile" : `${profileUser?.username || "User"}'s profile`}>
          <div className="profile-cover">
            {profileUser?.cover_image && <img src={profileUser.cover_image} alt="" className="profile-cover-image" />}
            {isOwnProfile && (
              <>
                <button
                  type="button"
                  className="profile-cover-edit"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverUploading}
                  aria-label={coverUploading ? "Uploading cover photo" : "Change cover photo"}
                  title={coverUploading ? "Uploading..." : "Change cover photo"}
                >
                  <ProfileIcon name="camera" />
                </button>
                <input
                  ref={coverInputRef}
                  className="profile-cover-input"
                  type="file"
                  accept="image/*"
                  onChange={handleCoverChange}
                  disabled={coverUploading}
                  tabIndex={-1}
                />
              </>
            )}
          </div>
          <div className="profile-identity">
            <div className={`profile-avatar-wrap${statuses.length ? " has-active-status" : ""}`}>
              <Avatar src={profileUser?.avatar} name={profileUser?.username} className="profile-avatar" />
              {isOwnProfile && (
                <button
                  type="button"
                  className="profile-avatar-edit"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  aria-label={uploading ? "Uploading profile photo" : "Change profile photo"}
                  title={uploading ? "Uploading..." : "Change profile photo"}
                >
                  {uploading ? "…" : (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
                      <circle cx="12" cy="13" r="3" />
                    </svg>
                  )}
                </button>
              )}
              <input
                ref={fileInputRef}
                className="profile-photo-input"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={!isOwnProfile || uploading}
                tabIndex={-1}
              />
            </div>
            <div className="profile-identity-copy">
              <h1>{profileUser?.username || (loading ? "Loading profile…" : "Profile")}</h1>
              <p>@{profileUser?.username || ""}</p>
              <span className={isOwnProfile ? "profile-streak" : undefined}>
                {isOwnProfile
                  ? dareStatsError
                    ? "Dare stats unavailable"
                    : dareStats
                    ? <><ProfileIcon name="streak" /> {dareStats.streak}-day streak</>
                    : "Loading dare stats…"
                  : "Profile and recent posts"}
              </span>
            </div>
            {isOwnProfile ? <button
              type="button"
              className="profile-edit-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Updating..." : "Edit photo"}
            </button> : isFriend && (
              <div className="profile-visitor-actions">
                <button
                  type="button"
                  className="profile-message-friend-button"
                  onClick={() => messageFriend(profileUser)}
                >
                  Message
                </button>
                <button
                  type="button"
                  className="profile-remove-friend-button"
                  onClick={removeProfileFriend}
                  disabled={removingFriendId === profileUser?.id}
                >
                  {removingFriendId === profileUser?.id ? "Removing…" : "Remove friend"}
                </button>
              </div>
            )}
          </div>

          <section className="profile-bio-section" aria-label="Profile bio">
            <div className="profile-bio-heading">
              <h2>About</h2>
              {isOwnProfile && !bioEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setBioDraft(profileUser?.bio || "");
                    setBioEditing(true);
                    setError("");
                  }}
                >
                  {profileUser?.bio ? "Edit bio" : "Add bio"}
                </button>
              )}
            </div>
            {bioEditing ? (
              <form className="profile-bio-form" onSubmit={handleSaveBio}>
                <textarea
                  value={bioDraft}
                  onChange={(event) => setBioDraft(event.target.value)}
                  maxLength={160}
                  rows={3}
                  placeholder="A little about you..."
                  aria-label="Edit your bio"
                />
                <div className="profile-bio-form-actions">
                  <span>{bioDraft.length}/160</span>
                  <button type="button" onClick={() => setBioEditing(false)} disabled={bioSaving}>
                    Cancel
                  </button>
                  <button type="submit" disabled={bioSaving}>
                    {bioSaving ? "Saving..." : "Save bio"}
                  </button>
                </div>
              </form>
            ) : (
              <p className={profileUser?.bio ? "" : "profile-bio-empty"}>
                {profileUser?.bio || (isOwnProfile ? "Add a short bio so friends can get to know you." : "No bio yet.")}
              </p>
            )}
          </section>

          <div className="profile-stats" aria-label="Profile statistics">
            {isOwnProfile ? (
              <div><strong>{dareStats?.completed ?? "—"}</strong><span>Dares</span></div>
            ) : (
              <div><strong>{posts.length}</strong><span>Posts</span></div>
            )}
            <button
              type="button"
              className="profile-friends-stat"
              onClick={() => friendsAvailable && setFriendsOpen(true)}
              disabled={!friendsAvailable}
              aria-label={`${friendCount ?? "Unknown"} friends${friendsAvailable ? ", open friends list" : ""}`}
            >
              <strong>{friendCount ?? "—"}</strong><span>Friends</span>
            </button>
            {isOwnProfile ? (
              <div><strong>{dareStats?.points ?? "—"}</strong><span>Points</span></div>
            ) : (
              <div><strong>{statuses.length}</strong><span>Active status</span></div>
            )}
          </div>
          {isOwnProfile && dareStatsError && <p className="profile-stats-error" role="status">{dareStatsError}</p>}

          <div className="profile-highlights">
            <div className="profile-highlights-heading">
              <h2>Recent status</h2>
              <span>Expires after 24 hours</span>
            </div>
            <div className="profile-highlight-list">
              {statuses.length === 0 ? (
                <div className="profile-highlight-empty">
                  <span className="profile-highlight-add"><ProfileIcon name="plus" /></span>
                  <span>No active status</span>
                </div>
              ) : statuses.slice(0, 6).map((status) => (
                <div className="profile-highlight" key={status.id}>
                  <div className="profile-highlight-ring">
                    <div
                      className="profile-highlight-content"
                      style={{ background: status.image_url ? `center / cover url("${status.image_url}")` : status.background_color }}
                    >
                      {!status.image_url && (status.content || "Status")}
                    </div>
                  </div>
                  <span>{formatDate(status.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {isOwnProfile && <details className="profile-mobile-actions">
          <summary>
            <span className="profile-mobile-action-icon"><ProfileIcon name="settings" /></span>
            <span><strong>Profile &amp; account options</strong><small>Friends, posts and settings</small></span>
            <span className="profile-mobile-action-arrow"><ProfileIcon name="chevron" /></span>
          </summary>
          <Link to="/requests">
            <span className="profile-mobile-action-icon"><ProfileIcon name="friends" /></span>
            <span><strong>Friends &amp; requests</strong><small>Manage your friends and requests</small></span>
            <span className="profile-mobile-action-arrow"><ProfileIcon name="chevron" /></span>
          </Link>
          <Link to="/dares">
            <span className="profile-mobile-action-icon"><ProfileIcon name="trophy" /></span>
            <span><strong>Badges &amp; ranks</strong><small>Your achievements and leaderboard</small></span>
            <span className="profile-mobile-action-arrow"><ProfileIcon name="chevron" /></span>
          </Link>
          <button type="button" onClick={(event) => {
            event.currentTarget.closest("details").open = false;
            setActiveTab("posts");
            document.getElementById("profile-content")?.scrollIntoView({ behavior: "smooth" });
          }}>
            <span className="profile-mobile-action-icon"><ProfileIcon name="posts" /></span>
            <span><strong>My posts</strong><small>Photos and updates you have shared</small></span>
            <span className="profile-mobile-action-arrow"><ProfileIcon name="chevron" /></span>
          </button>
          <Link to="/settings">
            <span className="profile-mobile-action-icon"><ProfileIcon name="settings" /></span>
            <span><strong>Settings</strong><small>Appearance and account preferences</small></span>
            <span className="profile-mobile-action-arrow"><ProfileIcon name="chevron" /></span>
          </Link>
          <button type="button" onClick={handleLogout}>
            <span className="profile-mobile-action-icon logout"><ProfileIcon name="logout" /></span>
            <span><strong>Log out</strong><small>Sign out of your account</small></span>
            <span className="profile-mobile-action-arrow"><ProfileIcon name="chevron" /></span>
          </button>
        </details>}

        {error && <p className="profile-error" role="alert">{error}</p>}

        {friendsOpen && (
          <div className="profile-friends-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFriendsOpen(false);
          }}>
            <section
              className="profile-friends-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-friends-title"
            >
              <header>
                <div>
                  <h2 id="profile-friends-title">{isOwnProfile ? "Your friends" : `${profileUser?.username || "Their"}'s friends`}</h2>
                  <span>{friends.length} {friends.length === 1 ? "friend" : "friends"}</span>
                </div>
                <button type="button" onClick={() => setFriendsOpen(false)} aria-label="Close friends list">×</button>
              </header>
              {friends.length === 0 ? (
                <p className="profile-friends-empty">You haven't added any friends yet.</p>
              ) : (
                <ul className="profile-friends-list">
                  {friends.map((friend) => (
                    <li key={friend.id}>
                      <Avatar src={friend.avatar} name={friend.username} className="profile-friend-avatar" />
                      <strong>{friend.username}</strong>
                      <div className="profile-friend-actions">
                        {isOwnProfile && (
                          <>
                            <button type="button" onClick={() => messageFriend(friend)}>Message</button>
                            <button
                              type="button"
                              className="remove"
                              disabled={removingFriendId === friend.id}
                              onClick={() => removeFriend(friend)}
                            >
                              {removingFriendId === friend.id ? "Removing…" : "Remove"}
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <section className="profile-content" id="profile-content">
          <div className="profile-tabs" role="tablist" aria-label="Profile content">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "posts"}
              className={activeTab === "posts" ? "active" : ""}
              onClick={() => setActiveTab("posts")}
            >
              <span aria-hidden="true">▦</span> Posts <span className="profile-tab-count">{posts.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "statuses"}
              className={activeTab === "statuses" ? "active" : ""}
              onClick={() => setActiveTab("statuses")}
            >
              <span aria-hidden="true">◉</span> Status <span className="profile-tab-count">{statuses.length}</span>
            </button>
          </div>

          {loading ? (
            <p className="profile-empty">Loading your profile…</p>
          ) : activeTab === "posts" ? (
            posts.length > 0 ? (
              <div className="profile-post-grid">
                {posts.map((post) => (
                  <article className="profile-post-tile" key={post.id}>
                    {post.image_url ? (
                      <img src={post.image_url} alt={post.caption || "Your post"} />
                    ) : (
                      <div
                        className="profile-post-text-tile"
                        style={{ background: getTextPostStyle(post.text_style).background }}
                      >
                        {post.caption || "Post"}
                      </div>
                    )}
                    <div className="profile-post-overlay">
                      <span>{post.caption || "Your post"}</span>
                      {isOwnProfile && (
                        <button type="button" onClick={() => deletePost(post.id)} aria-label="Delete post">
                          Delete
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
            <p className="profile-empty">
              {isOwnProfile ? "Your posts will appear here." : `${profileUser?.username || "This user"} has no posts yet.`}
            </p>
            )
          ) : (
            statuses.length > 0 ? (
              <div className="profile-status-grid">
                {statuses.map((status) => (
                  <article
                    className="profile-status-tile"
                    key={status.id}
                    style={{ background: status.image_url ? `center / cover url("${status.image_url}")` : status.background_color }}
                  >
                    <p>{status.content || "Photo status"}</p>
                    <time>{formatDate(status.created_at)}</time>
                    {isOwnProfile && (
                      <button type="button" onClick={() => deleteStatus(status.id)} aria-label="Delete status">
                        Delete
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="profile-empty">
                {isOwnProfile ? "Your active statuses will appear here." : `${profileUser?.username || "This user"} has no active statuses.`}
              </p>
            )
          )}
        </section>
      </div>
    </main>
  );
}
