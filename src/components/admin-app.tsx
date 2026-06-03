"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import {
  Bot,
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  UsersRound
} from "lucide-react";
import { AuthPanel } from "./auth-panel";
import { AccountsManager } from "./accounts-manager";
import { AIConfigPage } from "./ai-config-page";
import { AIDestinationsManager } from "./ai-destinations-manager";
import { ApplicationsManager } from "./applications-manager";
import { BuildingManager } from "./building-manager";
import { CompanyManager } from "./company-manager";
import { Dashboard } from "./dashboard";
import { MobileUsersManager } from "./mobile-users-manager";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import { canManageAccounts } from "@/lib/format";
import { I18nProvider, useI18n } from "@/lib/i18n";
import type { AccountProfile } from "@/lib/types";

type ViewKey =
  | "dashboard"
  | "building"
  | "companies"
  | "units"
  | "map"
  | "applications"
  | "mobileUsers"
  | "aiConfig"
  | "aiDestinations"
  | "accounts";
type AdminAppProps = {
  initialView?: ViewKey;
};

const routeByView: Record<ViewKey, string> = {
  dashboard: "/",
  building: "/buildings",
  companies: "/companies",
  units: "/units",
  map: "/map",
  applications: "/applications",
  mobileUsers: "/mobile-users",
  aiConfig: "/ai-config",
  aiDestinations: "/ai-destinations",
  accounts: "/accounts"
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
  if (pathname.startsWith("/applications")) {
    return "applications";
  }
  if (pathname.startsWith("/mobile-users")) {
    return "mobileUsers";
  }
  if (pathname.startsWith("/ai-config")) {
    return "aiConfig";
  }
  if (pathname.startsWith("/ai-destinations")) {
    return "aiDestinations";
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
  return (
    <I18nProvider>
      <AdminAppContent initialView={initialView} />
    </I18nProvider>
  );
}

function AdminAppContent({ initialView = "dashboard" }: AdminAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { language, setLanguage, t } = useI18n();
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
        full_name: nextSession.user.user_metadata?.full_name ?? null,
        role: "viewer",
        status: "pending",
        account_kind: "admin",
        email_confirmed_at: nextSession.user.email_confirmed_at ?? null
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
        setMessage(sessionError instanceof Error ? sessionError.message : t("shell.restoreSessionFailed"));
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
  }, [loadProfile, t]);

  const navItems = useMemo(
    () => [
      { key: "dashboard" as const, label: t("nav.dashboard"), icon: LayoutDashboard },
      { key: "building" as const, label: t("nav.building"), icon: Building2 },
      { key: "companies" as const, label: t("nav.companies"), icon: BriefcaseBusiness },
      { key: "units" as const, label: t("nav.units"), icon: DoorOpen },
      { key: "map" as const, label: t("nav.map"), icon: MapPinned },
      { key: "applications" as const, label: t("nav.applications"), icon: ClipboardList },
      { key: "mobileUsers" as const, label: t("nav.mobileUsers"), icon: Smartphone, requiresAccountAdmin: true },
      { key: "aiConfig" as const, label: t("nav.aiConfig"), icon: Settings2 },
      { key: "aiDestinations" as const, label: t("nav.aiDestinations"), icon: Bot },
      { key: "accounts" as const, label: t("nav.accounts"), icon: UsersRound, requiresAccountAdmin: true }
    ],
    [t]
  );

  async function claimFirstAdmin() {
    setMessage(null);
    const { data, error } = await supabase.rpc("claim_first_admin");

    if (error) {
      setMessage(error.message);
      return;
    }

    setProfile(data as AccountProfile);
    setMessage(t("shell.firstAdminClaimed"));
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  if (isLoading) {
    return (
      <main className="auth-page">
        <div className="message">{t("shell.loading")}</div>
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

  const hasActiveAdminAccess = profile?.account_kind === "admin" && profile.status === "active";
  const canManageAccountAccess = canManageAccounts(profile?.role, profile?.account_kind, profile?.status);

  if (!hasActiveAdminAccess) {
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
              <div className="eyebrow">{t("shell.adminConsole")}</div>
              <strong>{session.user.email}</strong>
            </div>
          </div>
          <h1>{t("shell.noAdminAccessTitle")}</h1>
          <p className="muted" style={{ marginTop: 10 }}>
            {profile?.status === "pending" ? t("shell.noAdminAccessPending") : t("shell.noAdminAccessBody")}
          </p>
          {message ? <div className="message" style={{ marginTop: 16 }}>{message}</div> : null}
          <div className="auth-form">
            <button className="button" onClick={signOut} type="button">
              <LogOut size={15} />
              {t("shell.signOut")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-console">
      <aside className="console-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">PopStreet</div>
            <div className="brand-kicker">{t("shell.adminConsole")}</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Admin navigation">
          <div className="sidebar-section-label">{t("shell.workspace")}</div>
          {navItems
            .filter((item) => !item.requiresAccountAdmin || canManageAccountAccess)
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
            {t("shell.dataSourcesHealthy")}
          </div>
          <small>{t("shell.supabaseLive")}</small>
        </div>
      </aside>

      <div className="console-main">
        <header className="console-topbar">
          <div className="breadcrumb-row">
            <span>{t("shell.workspace")}</span>
            <ChevronRight size={14} />
            <strong>{t(`views.${view}`)}</strong>
          </div>

          <div className="console-topbar-actions">
            <div className="global-search" aria-hidden="true">
              <Search size={16} />
              <span>{t("shell.globalSearch")}</span>
              <kbd>⌘K</kbd>
            </div>
            <div className="language-switch" aria-label={t("shell.language")}>
              <button
                className={language === "en" ? "active" : ""}
                onClick={() => setLanguage("en")}
                type="button"
              >
                {t("shell.english")}
              </button>
              <button
                className={language === "zh" ? "active" : ""}
                onClick={() => setLanguage("zh")}
                type="button"
              >
                {t("shell.chinese")}
              </button>
            </div>
            <span className="env-pill">{t("shell.env")}</span>
            <span className={`role-pill ${profile?.role ?? "viewer"}`}>
              <ShieldCheck size={14} />
              {profile ? t(`roles.${profile.role}`) : t("shell.noRole")}
            </span>
            <div className="user-chip">
              <div className="avatar-mark">{(session.user.email ?? "PS").slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{session.user.email}</strong>
                <span>{profile ? t(`roles.${profile.role}`) : t("shell.signedIn")}</span>
              </div>
            </div>
            <button className="ghost-button compact-button" onClick={signOut} type="button">
              <LogOut size={15} />
              {t("shell.signOut")}
            </button>
          </div>
        </header>

        <section className="console-content">
          {message ? <div className="message" style={{ marginBottom: 14 }}>{message}</div> : null}
          {profile?.account_kind !== "mobile" && profile?.role === "viewer" ? (
            <div className="message" style={{ marginBottom: 14 }}>
              {t("shell.viewerAccess")}
              <button className="ghost-button" onClick={claimFirstAdmin} style={{ marginLeft: 12 }} type="button">
                {t("shell.claimFirstAdmin")}
              </button>
            </div>
          ) : null}

          {view === "dashboard" ? <Dashboard /> : null}
          {view === "building" ? <BuildingManager mode="building" profile={profile} /> : null}
          {view === "companies" ? <CompanyManager profile={profile} /> : null}
          {view === "units" ? <BuildingManager mode="units" profile={profile} /> : null}
          {view === "map" ? <BuildingManager mode="map" profile={profile} /> : null}
          {view === "applications" ? <ApplicationsManager profile={profile} /> : null}
          {view === "mobileUsers" && canManageAccountAccess ? <MobileUsersManager /> : null}
          {view === "aiConfig" ? <AIConfigPage profile={profile} /> : null}
          {view === "aiDestinations" ? <AIDestinationsManager profile={profile} /> : null}
          {view === "accounts" && canManageAccountAccess ? <AccountsManager currentProfile={profile} /> : null}
        </section>
      </div>
    </main>
  );
}
