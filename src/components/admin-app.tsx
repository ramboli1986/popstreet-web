"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Building2, DoorOpen, LayoutDashboard, LogOut, MapPinned, ShieldCheck, UsersRound } from "lucide-react";
import { AuthPanel } from "./auth-panel";
import { AccountsManager } from "./accounts-manager";
import { BuildingManager } from "./building-manager";
import { Dashboard } from "./dashboard";
import { supabase } from "@/lib/supabase";
import { canManageAccounts, roleLabel } from "@/lib/format";
import type { AccountProfile } from "@/lib/types";

type ViewKey = "dashboard" | "building" | "units" | "map" | "accounts";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error("Saved login session timed out. Please log in again.")), timeoutMs);
    })
  ]);
}

export function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadProfile = useCallback(async (nextSession: Session | null) => {
    if (!nextSession?.user) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("account_profiles")
      .select("*")
      .eq("id", nextSession.user.id)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data) {
      setProfile(data as AccountProfile);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("account_profiles")
      .insert({
        id: nextSession.user.id,
        email: nextSession.user.email ?? "",
        full_name: nextSession.user.user_metadata?.full_name ?? null
      })
      .select("*")
      .single();

    if (insertError) {
      setMessage(insertError.message);
      return;
    }

    setProfile(inserted as AccountProfile);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function boot() {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 5000);
        if (!isMounted) {
          return;
        }
        setSession(data.session);
        await loadProfile(data.session);
      } catch (sessionError) {
        if (!isMounted) {
          return;
        }
        supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        setSession(null);
        setProfile(null);
        setMessage(sessionError instanceof Error ? sessionError.message : "Could not restore the saved session.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    boot();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      loadProfile(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const navItems = useMemo(
    () => [
      { key: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
      { key: "building" as const, label: "Building", icon: Building2 },
      { key: "units" as const, label: "Units", icon: DoorOpen },
      { key: "map" as const, label: "Map edit", icon: MapPinned },
      { key: "accounts" as const, label: "Accounts", icon: UsersRound, requiresAccountAdmin: true }
    ],
    []
  );

  async function claimFirstAdmin() {
    setMessage(null);
    const { data, error } = await supabase.rpc("claim_first_admin");

    if (error) {
      setMessage(error.message);
      return;
    }

    setProfile(data as AccountProfile);
    setMessage("This account is now the first super admin.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  if (isLoading) {
    return (
      <main className="auth-page">
        <div className="message">Loading PopStreet Admin...</div>
      </main>
    );
  }

  if (!session) {
    return <AuthPanel />;
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div className="brand-row">
          <div className="brand-mark">P</div>
          <div className="brand-copy">
            <div className="eyebrow">PopStreet Admin</div>
            <strong>Buildings, units, and availability</strong>
          </div>
        </div>

        <div className="topbar-actions">
          <span className={`role-pill ${profile?.role ?? "viewer"}`}>
            <ShieldCheck size={14} />
            {profile ? roleLabel(profile.role) : "No role"}
          </span>
          <span className="muted">{session.user.email}</span>
          <button className="ghost-button" onClick={signOut} type="button">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          {navItems
            .filter((item) => !item.requiresAccountAdmin || canManageAccounts(profile?.role))
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={`nav-button ${view === item.key ? "active" : ""}`}
                  key={item.key}
                  onClick={() => setView(item.key)}
                  type="button"
                >
                  <Icon size={17} />
                  {item.label}
                </button>
              );
            })}
        </aside>

        <section className="content">
          {message ? <div className="message" style={{ marginBottom: 14 }}>{message}</div> : null}
          {profile?.role === "viewer" ? (
            <div className="message" style={{ marginBottom: 14 }}>
              You currently have viewer access. If this is the first admin account, claim super admin below. Otherwise ask
              an admin to upgrade your role.
              <button className="ghost-button" onClick={claimFirstAdmin} style={{ marginLeft: 12 }} type="button">
                Claim first admin
              </button>
            </div>
          ) : null}

          {view === "dashboard" ? <Dashboard /> : null}
          {view === "building" ? <BuildingManager mode="building" profile={profile} /> : null}
          {view === "units" ? <BuildingManager mode="units" profile={profile} /> : null}
          {view === "map" ? <BuildingManager mode="map" profile={profile} /> : null}
          {view === "accounts" && canManageAccounts(profile?.role) ? <AccountsManager currentProfile={profile} /> : null}
        </section>
      </div>
    </main>
  );
}
