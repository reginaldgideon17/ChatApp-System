import { useState } from "react";
import AuthArt from "./AuthArt";
import { APP_NAME, passwordStrength } from "./authHelpers";

// The card that wraps both pages: picture on the left, form on the right.
export function AuthShell({ title, subtitle, footer, children }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <aside className="auth-art">
          <div className="auth-art-brand">{APP_NAME}</div>
          <AuthArt />
          <p className="auth-art-tagline">Chat, call and share moments with the people who matter.</p>
        </aside>

        <main className="auth-panel">
          <h1 className="auth-title">{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
          <p className="auth-footer">{footer}</p>
        </main>
      </div>
    </div>
  );
}

// A labelled text box that can show its own error underneath.
export function Field({ id, label, error, ...inputProps }) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? `${id}-error` : undefined}
        {...inputProps}
      />
      {error && <p className="auth-field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

// Same as Field, but with the show/hide eye. `children` is shown under the box (e.g. strength bar).
export function PasswordField({ id, label, error, children, ...inputProps }) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-password">
        <input
          id={id}
          type={show ? "text" : "password"}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${id}-error` : undefined}
          {...inputProps}
        />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {show ? (
              <>
                <path d="M17.94 17.94A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a19.7 19.7 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-3.17 4.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <path d="M1 1l22 22" />
              </>
            ) : (
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </div>
      {error && <p className="auth-field-error" id={`${id}-error`}>{error}</p>}
      {children}
    </div>
  );
}

// Four little bars that fill up as the password gets stronger.
export function StrengthMeter({ password }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="auth-strength" aria-live="polite">
      <div className="auth-strength-bars">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= score ? `on level-${score}` : ""} />
        ))}
      </div>
      <span className="auth-strength-label">{label}</span>
    </div>
  );
}

// The submit button: shows a spinner while waiting.
export function SubmitButton({ loading, idle, busy }) {
  return (
    <button type="submit" className="auth-button" disabled={loading}>
      {loading && <span className="auth-spinner" aria-hidden="true" />}
      {loading ? busy : idle}
    </button>
  );
}

// Explains the wait when Render's free server is waking up.
export function WakingNotice() {
  return (
    <p className="auth-notice" role="status">
      Waking up the server… the first request after a quiet spell can take up to a minute.
    </p>
  );
}