"use client";

import { useState } from "react";
import { Building2, LockKeyhole, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";

export function AuthPanel() {
  const { language, setLanguage, t } = useI18n();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: window.location.origin,
              data: {
                full_name: fullName
              }
            }
          });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage(t("auth.signupMessage"));
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card-language">
          <div className="language-switch" aria-label={t("shell.language")}>
            <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")} type="button">
              {t("shell.english")}
            </button>
            <button className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")} type="button">
              {t("shell.chinese")}
            </button>
          </div>
        </div>

        <div className="brand-row">
          <div className="brand-mark">P</div>
          <div className="brand-copy">
            <div className="eyebrow">{t("auth.product")}</div>
            <strong>{t("auth.console")}</strong>
          </div>
        </div>

        <h1>{mode === "login" ? t("auth.welcome") : t("auth.createAccount")}</h1>
        <p className="muted" style={{ marginTop: 10 }}>
          {t("auth.subtitle")}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" ? (
            <label className="field">
              <span>{t("auth.fullName")}</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
          ) : null}

          <label className="field">
            <span>{t("auth.email")}</span>
            <div style={{ position: "relative" }}>
              <Mail size={17} style={{ left: 12, position: "absolute", top: 13, color: "#767d89" }} />
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={{ paddingLeft: 38 }}
              />
            </div>
          </label>

          <label className="field">
            <span>{t("auth.password")}</span>
            <div style={{ position: "relative" }}>
              <LockKeyhole size={17} style={{ left: 12, position: "absolute", top: 13, color: "#767d89" }} />
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{ paddingLeft: 38 }}
              />
            </div>
          </label>

          {error ? <div className="message error">{error}</div> : null}
          {message ? <div className="message">{message}</div> : null}

          <button className="button" disabled={isSubmitting} type="submit">
            <Building2 size={17} />
            {isSubmitting ? t("auth.working") : mode === "login" ? t("auth.login") : t("auth.create")}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 18, fontSize: 14 }}>
          {mode === "login" ? t("auth.needAccount") : t("auth.alreadyHaveAccess")}{" "}
          <button className="link-button" onClick={() => setMode(mode === "login" ? "signup" : "login")} type="button">
            {mode === "login" ? t("auth.register") : t("auth.login")}
          </button>
        </p>
      </section>
    </main>
  );
}
