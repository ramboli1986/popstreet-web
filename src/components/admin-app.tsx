"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import {
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Search,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import { AuthPanel } from "./auth-panel";
import { AccountsManager } from "./accounts-manager";
import { BuildingManager } from "./building-manager";
import { CompanyManager } from "./company-manager";
import { Dashboard } from "./dashboard";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import { canManageAccounts, roleLabel } from "@/lib/format";
import type { AccountProfile } from "@/lib/types";

type ViewKey = "dashboard" | "building" | "companies" | "units" | "map" | "accounts";
type AdminAppProps = {
  initialView?: ViewKey;
};

const routeByView: Record<ViewKey, string> = {
  dashboard: "/",
  building: "/buildings",
  companies: "/companies",
  units: "/units",
  map: "/map",
  accounts: "/accounts"
};

const pageTitleByView: Record<ViewKey, string> = {
  dashboard: "Overview",
  building: "Buildings",
  companies: "Companies",
  units: "Units & Deals",
  map: "Map",
  accounts: "Accounts"
};

function viewFromPath(pathname: string): ViewKey {
  if (pathname.startsWith("/buildings")) {
    return "building";
  }
  if (pathname.startsWith("/companies")) {
    return "companies";
  }
  if (pathname.startsWith("/units")) {
    return "units";
  }
  if (pathname.startsWith("/map")) {
    return "map";
  }
  if (pathname.startsWith("/accounts")) {
    return "accounts";
  }
  return "dashboard";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error("Saved login session timed out. Please log in again.")), timeoutMs);
    })
  ]);
}

export function AdminApp({ initialView = "dashboard" }: AdminAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [view, setView] = useState<ViewKey>(initialView);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setView(viewFromPath(pathname));
  }, [pathname]);

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

    if (supabaseConfigError) {
      setMessage(supabaseConfigError);
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }

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
      { key: "building" as const, label: "Buildings", icon: Building2 },
      { key: "companies" as const, label: "Companies", icon: BriefcaseBusiness },
      { key: "units" as const, label: "Units & Deals", icon: DoorOpen },
      { key: "map" as const, label: "Map", icon: MapPinned },
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

  if (supabaseConfigError) {
    return (
      <main className="auth-page">
        <div className="message error">{message ?? supabaseConfigError}</div>
      </main>
    );
  }

  if (!session) {
    return <AuthPanel />;
  }

  return (
    <main className="admin-console">
      <aside className="console-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">PopStreet</div>
            <div className="brand-kicker">Admin Console</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Admin navigation">
          <div className="sidebar-section-label">Workspace</div>
          {navItems
            .filter((item) => !item.requiresAccountAdmin || canManageAccounts(profile?.role))
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={`nav-button ${view === item.key ? "active" : ""}`}
                  key={item.key}
                  onClick={() => {
                    setView(item.key);
                    router.push(routeByView[item.key]);
                  }}
                  type="button"
                >
                  <Icon size={17} />
                  {item.label}
                </button>
              );
            })}
        </nav>

        <div className="sidebar-health">
          <div>
            <span className="health-dot" />
            Data sources healthy
          </div>
          <small>Supabase live</small>
        </div>
      </aside>

      <div className="console-main">
        <header className="console-topbar">
          <div className="breadcrumb-row">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{pageTitleByView[view]}</strong>
          </div>

          <div className="console-topbar-actions">
            <div className="global-search" aria-hidden="true">
              <Search size={16} />
              <span>Search buildings, units, companies...</span>
              <kbd>⌘K</kbd>
            </div>
            <span className="env-pill">prod</span>
            <span className={`role-pill ${profile?.role ?? "viewer"}`}>
              <ShieldCheck size={14} />
              {profile ? roleLabel(profile.role) : "No role"}
            </span>
            <div className="user-chip">
              <div className="avatar-mark">{(session.user.email ?? "PS").slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{session.user.email}</strong>
                <span>{profile ? roleLabel(profile.role) : "Signed in"}</span>
              </div>
            </div>
            <button className="ghost-button compact-button" onClick={signOut} type="button">
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </header>

        <section className="console-content">
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
          {view === "companies" ? <CompanyManager profile={profile} /> : null}
          {view === "units" ? <BuildingManager mode="units" profile={profile} /> : null}
          {view === "map" ? <BuildingManager mode="map" profile={profile} /> : null}
          {view === "accounts" && canManageAccounts(profile?.role) ? <AccountsManager currentProfile={profile} /> : null}
        </section>
      </div>
    </main>
  );
}
