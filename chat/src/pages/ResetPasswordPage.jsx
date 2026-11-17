import { useEffect, useState } from "react";
import "../css/LoginPage.css";
import { AuthShell, PasswordField, StrengthMeter, SubmitButton, WakingNotice } from "./AuthParts";
import { postAuth } from "./authHelpers";

export default function ResetPasswordPage() {
  // The link in the email looks like  /reset-password?token=abc123...
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const [stage, setStage] = useState(token ? "checking" : "invalid"); // checking | ready | invalid | done
  const [invalidMessage, setInvalidMessage] = useState("This reset link is not valid.");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState({});
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [slow, setSlow] = useState(false);

  // Ask the server if the link still works before showing the form
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    postAuth("/api/auth/reset-password/check", { token }, () => setSlow(true))
      .then(() => !cancelled && setStage("ready"))
      .catch((err) => {
        if (cancelled) return;
        setInvalidMessage(err.message);
        setStage("invalid");
      })
      .finally(() => !cancelled && setSlow(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const errors = {
    password: !password ? "Choose a new password." : password.length < 6 ? "Use at least 6 characters." : "",
    confirm: !confirm ? "Type the password again." : confirm !== password ? "The two passwords don't match." : "",
  };
  const shown = (f) => (touched[f] ? errors[f] : "");
  const touch = (f) => () => setTouched((t) => ({ ...t, [f]: true }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setTouched({ password: true, confirm: true });
    if (errors.password || errors.confirm) return;

    setIsLoading(true);
    try {
      await postAuth("/api/auth/reset-password", { token, password }, () => setSlow(true));
      setStage("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setSlow(false);
    }
  }

  if (stage === "checking") {
    return (
      <AuthShell title="One moment…" subtitle="Checking your reset link." footer={<a href="/">Back to log in</a>}>
        <div className="auth-success">
          <span className="auth-spinner auth-spinner-big" aria-hidden="true" />
        </div>
        {slow && <WakingNotice />}
      </AuthShell>
    );
  }

  if (stage === "invalid") {
    return (
      <AuthShell title="Link not working" subtitle={invalidMessage} footer={<a href="/">Back to log in</a>}>
        <a className="auth-button auth-button-link" href="/forgot-password">Get a new link</a>
      </AuthShell>
    );
  }

  if (stage === "done") {
    return (
      <AuthShell title="Password updated" subtitle="You can log in with your new password now." footer={null}>
        <div className="auth-success">
          <span className="auth-success-icon auth-success-icon-ok" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </span>
        </div>
        <a className="auth-button auth-button-link" href="/">Log in</a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something you haven't used before."
      footer={<a href="/">Back to log in</a>}
    >
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <PasswordField
          id="new-password"
          label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={touch("password")}
          placeholder="At least 6 characters"
          autoComplete="new-password"
          error={shown("password")}
          autoFocus
        >
          <StrengthMeter password={password} />
        </PasswordField>

        <PasswordField
          id="confirm-password"
          label="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={touch("confirm")}
          placeholder="Type it again"
          autoComplete="new-password"
          error={shown("confirm")}
        />

        {slow && <WakingNotice />}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <SubmitButton loading={isLoading} idle="Update password" busy="Updating…" />
      </form>
    </AuthShell>
  );
}
