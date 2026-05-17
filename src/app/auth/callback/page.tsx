"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function completeAuth() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const errorDescription = params.get("error_description") ?? params.get("error");

      if (errorDescription) {
        setError(errorDescription);
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
      } else {
        const { error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          setError(sessionError.message);
          return;
        }
      }

      router.replace("/");
    }

    completeAuth();
  }, [router]);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-row">
          <div className="brand-mark">P</div>
          <div className="brand-copy">
            <div className="eyebrow">PopStreet Admin</div>
            <strong>Email confirmation</strong>
          </div>
        </div>
        <h1>{error ? "Confirmation failed" : "Confirming..."}</h1>
        <p className="muted" style={{ marginTop: 10 }}>
          {error ?? "Finishing sign-in and opening the admin console."}
        </p>
      </section>
    </main>
  );
}
