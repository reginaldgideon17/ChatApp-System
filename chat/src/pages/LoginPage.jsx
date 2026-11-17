import { useState } from "react";
import "../css/LoginPage.css";
import { AuthShell, Field, PasswordField, SubmitButton, WakingNotice } from "./AuthParts";
import { EMAIL_RE, postAuth, saveSession } from "./authHelpers";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({});
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [slow, setSlow] = useState(false);

  // What's wrong with each box right now (empty text = fine)
  const errors = {
    email: !email.trim()
      ? "Enter your email address."
      : !EMAIL_RE.test(email.trim())
      ? "That doesn't look like an email address."
      : "",
    password: !password ? "Enter your password." : "",
  };
  // Only show a box's error after the person has left it (or tried to submit)
  const shown = (field) => (touched[field] ? errors[field] : "");
  const touch = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setTouched({ email: true, password: true });
    if (errors.email || errors.password) return;

    setIsLoading(true);
    setSlow(false);
    try {
      const data = await postAuth(
        "/api/auth/login",
        { email: email.trim(), password },
        () => setSlow(true)
      );
      saveSession(data);
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
      setSlow(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to keep the conversation going."
      footer={<>Don't have an account? <a href="/signup">Sign up</a></>}
    >
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <Field
          id="email"
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={touch("email")}
          placeholder="you@example.com"
          autoComplete="email"
          error={shown("email")}
          autoFocus
        />

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={touch("password")}
          placeholder="Your password"
          autoComplete="current-password"
          error={shown("password")}
          labelAside={<a className="auth-link" href="/forgot-password">Forgot password?</a>}
        />

        {slow && <WakingNotice />}
        {error && <p className="auth-error" role="alert">{error}</p>}

        <SubmitButton loading={isLoading} idle="Log in" busy="Logging in…" />
      </form>
    </AuthShell>
  );
}