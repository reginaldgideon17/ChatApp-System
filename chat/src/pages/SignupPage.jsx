import { useState } from "react";
import "../css/LoginPage.css";
import { AuthShell, Field, PasswordField, StrengthMeter, SubmitButton, WakingNotice } from "./AuthParts";
import { EMAIL_RE, postAuth, saveSession } from "./authHelpers";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({});
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [slow, setSlow] = useState(false);

  const name = username.trim();
  const errors = {
    username: !name
      ? "Choose a username."
      : name.length < 3
      ? "Use at least 3 characters."
      : name.length > 30
      ? "Keep it under 30 characters."
      : "",
    email: !email.trim()
      ? "Enter your email address."
      : !EMAIL_RE.test(email.trim())
      ? "That doesn't look like an email address."
      : "",
    password: !password
      ? "Choose a password."
      : password.length < 6
      ? "Use at least 6 characters."
      : "",
  };
  const shown = (field) => (touched[field] ? errors[field] : "");
  const touch = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setTouched({ username: true, email: true, password: true });
    if (errors.username || errors.email || errors.password) return;

    setIsLoading(true);
    setSlow(false);
    try {
      const data = await postAuth(
        "/api/auth/signup",
        { username: name, email: email.trim(), password },
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
      title="Create Account"
      subtitle="Create an account to find your people."
      artTitle="Your people, closer."
      artSubtitle="Start conversations, share moments and stay connected."
      footer={<>Already have an account? <a href="/">Log in</a></>}
    >
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <Field
          id="username"
          label="Username"
          icon="user"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={touch("username")}
          placeholder="yourname"
          autoComplete="username"
          error={shown("username")}
          autoFocus
        />

        <Field
          id="email"
          label="Email address"
          icon="mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={touch("email")}
          placeholder="you@example.com"
          autoComplete="email"
          error={shown("email")}
        />

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={touch("password")}
          placeholder="At least 6 characters"
          autoComplete="new-password"
          error={shown("password")}
        >
          <StrengthMeter password={password} />
        </PasswordField>

        {slow && <WakingNotice />}
        {error && <p className="auth-error" role="alert">{error}</p>}

        <SubmitButton loading={isLoading} idle="Create Account" busy="Creating account…" />
      </form>
    </AuthShell>
  );
}