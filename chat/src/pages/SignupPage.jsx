import { useState } from "react";
import "../css/LoginPage.css";
import AuthArt from "./AuthArt";

const API_URL = "https://chatapp-system-mbzq.onrender.com";
const APP_NAME = "Morphues";

function EyeIcon({ off }) {
  return off ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a19.7 19.7 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-3.17 4.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!username || !email || !password) {
      setError("Fill in all fields to continue.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      window.location.href = "/inbox";
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <aside className="auth-art">
          <div className="auth-art-brand">{APP_NAME}</div>
          <AuthArt />
          <p className="auth-art-tagline">Chat, call and share moments with the people who matter.</p>
        </aside>

        <main className="auth-panel">
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Join the conversation in a minute.</p>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="auth-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="yourname"
                autoComplete="username"
              />
            </div>

            <div className="auth-field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <div className="auth-password">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Choose a password"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button type="submit" className="auth-button" disabled={isLoading}>
              {isLoading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <p className="auth-footer">
            Already have an account? <a href="/">Log in</a>
          </p>
        </main>
      </div>
    </div>
  );
}