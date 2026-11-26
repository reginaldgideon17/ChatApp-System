import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { resizeImage } from "../resizeImage";
import Avatar from "../components/Avatar";
import "../css/NewChat.css";
import { applyTheme, getSavedTheme } from "../theme";
import NotificationSettings from "../components/NotificationSettings";
import DareSettings from "../components/DareSettings";

export default function SettingsPage() {
  const { handleLogout } = useOutletContext();
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("user")));
  const [theme, setTheme] = useState(getSavedTheme);
  const token = localStorage.getItem("token");

  const [username, setUsername] = useState(user?.username || "");
  const [email, setEmail] = useState(user?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [uploading, setUploading] = useState(false);
  const [savingField, setSavingField] = useState(null); // "username" | "email" | "password" | null
  const [messages, setMessages] = useState({}); // { username: "...", email: "...", password: "..." }

  function updateLocalUser(patch) {
    const updated = { ...user, ...patch };
    localStorage.setItem("user", JSON.stringify(updated));
    setUser(updated);
  }

  function setFieldMessage(field, text, isError) {
    setMessages((prev) => ({ ...prev, [field]: { text, isError } }));
  }

  function handleThemeChange(nextTheme) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const resized = await resizeImage(file, 128);
      const response = await fetch("https://chatapp-system-mbzq.onrender.com/api/users/avatar", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ avatar: resized }),
      });
      if (!response.ok) throw new Error("Failed to update avatar.");
      updateLocalUser({ avatar: resized });
    } catch (err) {
      setFieldMessage("avatar", err.message, true);
    } finally {
      setUploading(false);
    }
  }

  async function handleUsernameSave() {
    setSavingField("username");
    setFieldMessage("username", null);
    try {
      const response = await fetch("https://chatapp-system-mbzq.onrender.com/api/users/username", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to update username.");
      updateLocalUser({ username: data.username });
      setFieldMessage("username", "Username updated.", false);
    } catch (err) {
      setFieldMessage("username", err.message, true);
    } finally {
      setSavingField(null);
    }
  }

  async function handleEmailSave() {
    setSavingField("email");
    setFieldMessage("email", null);
    try {
      const response = await fetch("https://chatapp-system-mbzq.onrender.com/api/users/email", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to update email.");
      updateLocalUser({ email: data.email });
      setFieldMessage("email", "Email updated.", false);
    } catch (err) {
      setFieldMessage("email", err.message, true);
    } finally {
      setSavingField(null);
    }
  }

  async function handlePasswordSave() {
    setSavingField("password");
    setFieldMessage("password", null);
    try {
      const response = await fetch("https://chatapp-system-mbzq.onrender.com/api/users/password", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to update password.");
      setCurrentPassword("");
      setNewPassword("");
      setFieldMessage("password", "Password updated.", false);
    } catch (err) {
      setFieldMessage("password", err.message, true);
    } finally {
      setSavingField(null);
    }
  }

  return (
    <div className="newchat-page settings-page">
      <header className="settings-page-heading">
        <Link to="/profile" className="settings-back-link" aria-label="Back to profile">‹</Link>
        <div>
          <h1>Settings</h1>
          <p>Manage your profile and account.</p>
        </div>
      </header>

      <section className="appearance-settings" aria-labelledby="appearance-title">
        <div>
          <h2 id="appearance-title">Appearance</h2>
          <p>Choose light or dark mode for Morphues.</p>
        </div>
        <div className="appearance-options" role="group" aria-label="Color mode">
          <button
            type="button"
            className={`appearance-choice${theme === "light" ? " selected" : ""}`}
            aria-pressed={theme === "light"}
            onClick={() => handleThemeChange("light")}
          >
            <span className="appearance-preview appearance-preview-light" aria-hidden="true">
              <i /><i /><i />
            </span>
            <span className="appearance-choice-label">
              <span className="appearance-choice-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </svg>
              </span>
              Light
            </span>
            <span className="appearance-choice-indicator" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`appearance-choice${theme === "dark" ? " selected" : ""}`}
            aria-pressed={theme === "dark"}
            onClick={() => handleThemeChange("dark")}
          >
            <span className="appearance-preview appearance-preview-dark" aria-hidden="true">
              <i /><i /><i />
            </span>
            <span className="appearance-choice-label">
              <span className="appearance-choice-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
                </svg>
              </span>
              Dark
            </span>
            <span className="appearance-choice-indicator" aria-hidden="true" />
          </button>
        </div>
      </section>

      <NotificationSettings />

      <DareSettings />

      <section className="settings-card settings-account-group" aria-labelledby="account-details-title">
        <h2 id="account-details-title">Account details</h2>
        <div className="settings-account-item">
          <label className="settings-label">Username</label>
          <div className="newchat-search">
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <button type="button" className="newchat-add-button" onClick={handleUsernameSave} disabled={savingField === "username"}>
            {savingField === "username" ? "Saving..." : "Save username"}
          </button>
          {messages.username && (
            <p className={messages.username.isError ? "newchat-error" : "newchat-subtitle"}>{messages.username.text}</p>
          )}
        </div>

        <div className="settings-account-item">
          <label className="settings-label">Email</label>
          <div className="newchat-search">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="button" className="newchat-add-button" onClick={handleEmailSave} disabled={savingField === "email"}>
            {savingField === "email" ? "Saving..." : "Save email"}
          </button>
          {messages.email && (
            <p className={messages.email.isError ? "newchat-error" : "newchat-subtitle"}>{messages.email.text}</p>
          )}
        </div>

        <div className="settings-account-item">
          <label className="settings-label">Change password</label>
          <div className="newchat-search settings-gap">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="newchat-search">
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <button type="button" className="newchat-add-button" onClick={handlePasswordSave} disabled={savingField === "password"}>
            {savingField === "password" ? "Saving..." : "Save password"}
          </button>
          {messages.password && (
            <p className={messages.password.isError ? "newchat-error" : "newchat-subtitle"}>{messages.password.text}</p>
          )}
        </div>
      </section>

      <section className="settings-card settings-profile" aria-label="Profile photo">
        <Avatar src={user?.avatar} name={user?.username} className="newchat-avatar" style={{ width: 72, height: 72, fontSize: 22 }} />
        <div className="settings-profile-copy">
          <strong>Profile photo</strong>
          <span>Choose a photo your friends will recognize.</span>
        </div>
        <label className="newchat-add-button">
          {uploading ? "Uploading..." : "Change photo"}
          <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} disabled={uploading} />
        </label>
      </section>
      {messages.avatar && (
        <p className={messages.avatar.isError ? "newchat-error" : "newchat-subtitle"}>{messages.avatar.text}</p>
      )}

      <button type="button" className="settings-logout-button" onClick={handleLogout}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 17l5-5-5-5M15 12H3" />
          <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
        </svg>
        Log out
      </button>
    </div>
  );
}