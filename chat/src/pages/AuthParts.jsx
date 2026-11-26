import { useState } from "react";
import AuthArt from "./AuthArt";
import { APP_NAME, passwordStrength } from "./authHelpers";
import { applyTheme, getSavedTheme } from "../theme";

// Sun / moon button in the corner of the log-in pages
function ThemeToggle() {
  const [theme, setTheme] = useState(getSavedTheme);
  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }
  return (
    <button
      type="button"
      className="auth-theme-toggle"
      onClick={flip}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

function AuthMark({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 2.8 27.2 9.2v13.6L16 29.2 4.8 22.8V9.2L16 2.8Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="m11 9.2 10 13.6M21 9.2 11 22.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// The shared split layout keeps the authentication forms consistent.
export function AuthShell({
  title,
  subtitle,
  footer,
  artTitle = "Stay close.",
  artSubtitle = "A thoughtful place to share the little moments that matter.",
  children,
}) {
  return (
    <div className="auth-page">
      <ThemeToggle />
      <div className="auth-card">
        <aside className="auth-art">
          <AuthArt />
          <a className="auth-art-brand" href="/" aria-label={`${APP_NAME} home`}>
            <span className="auth-brand-mark"><AuthMark /></span>
            <span>{APP_NAME}</span>
          </a>
          <div className="auth-art-copy">
            <h2>{artTitle}</h2>
            <p>{artSubtitle}</p>
          </div>
          <p className="auth-art-copyright">© 2026 {APP_NAME}. All rights reserved.</p>
        </aside>

        <main className="auth-panel">
          <div className="auth-panel-mark"><AuthMark /></div>
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
function FieldIcon({ icon }) {
  const paths = {
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></>,
  };
  return (
    <svg className="auth-input-leading" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[icon]}
    </svg>
  );
}

export function Field({ id, label, error, icon, ...inputProps }) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        {icon && <FieldIcon icon={icon} />}
        <input
          id={id}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${id}-error` : undefined}
          {...inputProps}
        />
      </div>
      {error && <p className="auth-field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

// Same as Field, but with the show/hide eye. `children` is shown under the box (e.g. strength bar).
export function PasswordField({ id, label, error, children, labelAside, icon = "lock", ...inputProps }) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-field">
      <div className="auth-label-row">
        <label htmlFor={id}>{label}</label>
        {labelAside}
      </div>
      <div className="auth-password auth-input-wrap">
        <FieldIcon icon={icon} />
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
      {!loading && (
        <svg className="auth-button-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
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