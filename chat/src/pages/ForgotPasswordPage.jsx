import { useEffect, useState } from "react";
import "../css/LoginPage.css";
import { AuthShell, Field, SubmitButton, WakingNotice } from "./AuthParts";
import { EMAIL_RE, postAuth } from "./authHelpers";

const RESEND_SECONDS = 30;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [sentTo, setSentTo] = useState(""); // filled once the email has been requested
  const [cooldown, setCooldown] = useState(0);

  const emailError = !email.trim()
    ? "Enter your email address."
    : !EMAIL_RE.test(email.trim())
    ? "That doesn't look like an email address."
    : "";

  // Counts down the "Send again" button
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestLink(address) {
    setError("");
    setIsLoading(true);
    setSlow(false);
    try {
      await postAuth("/api/auth/forgot-password", { email: address }, () => setSlow(true));
      setSentTo(address);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setSlow(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (emailError) return;
    requestLink(email.trim());
  }

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="Your reset link is on its way."
        footer={<a href="/">Back to log in</a>}
      >
        <div className="auth-success">
          <span className="auth-success-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>
          </span>
          <p>
            If an account exists for <strong>{sentTo}</strong>, we've sent a link to reset your password.
            It works for 30 minutes.
          </p>
          <p className="auth-hint">Nothing there? Check your spam folder.</p>
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button
          type="button"
          className="auth-secondary-button"
          disabled={cooldown > 0 || isLoading}
          onClick={() => requestLink(sentTo)}
        >
          {isLoading ? "Sending…" : cooldown > 0 ? `Send again in ${cooldown}s` : "Send the email again"}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={<>Remembered it? <a href="/">Log in</a></>}
    >
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <Field
          id="email"
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="you@example.com"
          autoComplete="email"
          error={touched ? emailError : ""}
          autoFocus
        />
        {slow && <WakingNotice />}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <SubmitButton loading={isLoading} idle="Send reset link" busy="Sending…" />
      </form>
    </AuthShell>
  );
}
