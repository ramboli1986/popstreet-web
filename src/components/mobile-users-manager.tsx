"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { AccountProfile, AccountStatus, Application, ApplicationStatus } from "@/lib/types";

type ProviderFilter = "all" | "google" | "apple" | "unknown";
type StatusFilter = "all" | AccountStatus;
type ApplicationLite = Pick<Application, "id" | "user_id" | "status" | "created_at" | "updated_at">;

type MobileUserStats = {
  activeApplications: number;
  firstApplicationAt: string | null;
  latestActivityAt: string | null;
  latestApplicationStatus: ApplicationStatus | null;
  totalApplications: number;
};

const activeApplicationStatuses: ApplicationStatus[] = [
  "submitted",
  "ops_in_progress",
  "link_ready",
  "submitted_to_lo",
  "under_review",
  "accepted",
  "cashback_pending"
];

const providerFilters: ProviderFilter[] = ["all", "google", "apple", "unknown"];
const statusFilters: StatusFilter[] = ["all", "active", "pending", "suspended"];
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

export function MobileUsersManager() {
  const { t } = useI18n();
  const [users, setUsers] = useState<AccountProfile[]>([]);
  const [applications, setApplications] = useState<ApplicationLite[]>([]);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const userResult = await supabase
      .from("account_profiles")
      .select("id,email,full_name,display_name,phone,role,status,account_kind,is_mobile_user,oauth_provider,oauth_subject,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    let userRows = userResult.data as AccountProfile[] | null;
    let userError = userResult.error;

    if (userError && shouldRetryWithoutProfileColumns(userError.message)) {
      const fallback = await supabase
        .from("account_profiles")
        .select("id,email,full_name,display_name,role,status,oauth_provider,oauth_subject,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      userRows = fallback.data as AccountProfile[] | null;
      userError = fallback.error;
    }

    if (userError) {
      setError(userError.message);
      setUsers([]);
      setApplications([]);
      setIsLoading(false);
      return;
    }

    const nextUsers = (userRows ?? []).filter(isMobileUserAccount);
    setUsers(nextUsers);

    const userIds = nextUsers.map((user) => user.id);
    if (userIds.length === 0) {
      setApplications([]);
      setIsLoading(false);
      return;
    }

    const { data: applicationRows, error: applicationError } = await supabase
      .from("applications")
      .select("id,user_id,status,created_at,updated_at")
      .in("user_id", userIds)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (applicationError) {
      setError(applicationError.message);
      setApplications([]);
    } else {
      setApplications((applicationRows ?? []) as ApplicationLite[]);
    }

    setIsLoading(false);
  }, []);

  async function cleanupLegacyAnonymousUsers() {
    if (!window.confirm(t("mobileUsers.cleanupConfirm"))) {
      return;
    }

    setIsCleaning(true);
    setError(null);
    setMessage(null);

    const { data, error: cleanupError } = await supabase.rpc("delete_legacy_anonymous_accounts");

    setIsCleaning(false);

    if (cleanupError) {
      setError(cleanupError.message);
      return;
    }

    const deletedCount = Array.isArray(data) ? data.length : 0;
    setMessage(t("mobileUsers.cleanupDeleted", { count: deletedCount }));
    await load();
  }

  useEffect(() => {
    load();
  }, [load]);

  const statsByUser = useMemo(() => buildStats(applications), [applications]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return users.filter((user) => {
      const provider = user.oauth_provider ?? "unknown";
      const matchesProvider = providerFilter === "all" || provider === providerFilter;
      const matchesStatus = statusFilter === "all" || user.status === statusFilter;
      const haystack = [
        user.email,
        user.full_name,
        user.display_name,
        user.phone,
        user.id,
        user.oauth_subject,
        user.oauth_provider
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = normalizedSearch.length === 0 || haystack.includes(normalizedSearch);
      return matchesProvider && matchesStatus && matchesSearch;
    });
  }, [providerFilter, search, statusFilter, users]);

  const summary = useMemo(() => {
    const now = Date.now();
    return {
      activeApplicants: users.filter((user) => (statsByUser.get(user.id)?.activeApplications ?? 0) > 0).length,
      apple: users.filter((user) => user.oauth_provider === "apple").length,
      google: users.filter((user) => user.oauth_provider === "google").length,
      newThisWeek: users.filter((user) => now - new Date(user.created_at).getTime() <= sevenDaysMs).length,
      total: users.length
    };
  }, [statsByUser, users]);

  return (
    <div className="mobile-users-page">
      <div className="content-header">
        <div>
          <div className="eyebrow">{t("mobileUsers.eyebrow")}</div>
          <h2>{t("mobileUsers.title")}</h2>
        </div>
        <div className="header-actions">
          <button className="ghost-button danger-ghost-button" disabled={isLoading || isCleaning} onClick={cleanupLegacyAnonymousUsers} type="button">
            <Trash2 size={16} />
            {isCleaning ? t("mobileUsers.cleaning") : t("mobileUsers.cleanupAnonymous")}
          </button>
          <button className="ghost-button" disabled={isLoading} onClick={load} type="button">
            <RefreshCcw size={16} />
            {t("common.refresh")}
          </button>
        </div>
      </div>

      {error ? <div className="message error compact-message">{error}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}

      <section className="grid-4">
        <Metric label={t("mobileUsers.totalUsers")} value={summary.total.toLocaleString()} />
        <Metric label={t("mobileUsers.googleUsers")} value={summary.google.toLocaleString()} />
        <Metric label={t("mobileUsers.appleUsers")} value={summary.apple.toLocaleString()} />
        <Metric label={t("mobileUsers.activeApplicants")} value={summary.activeApplicants.toLocaleString()} />
      </section>

      <section className="ops-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label={t("mobileUsers.search")}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("mobileUsers.search")}
            value={search}
          />
        </div>
        <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value as ProviderFilter)}>
          {providerFilters.map((provider) => (
            <option key={provider} value={provider}>
              {providerLabel(provider, t)}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          {statusFilters.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? t("mobileUsers.allStatuses") : t(`statuses.${status}`)}
            </option>
          ))}
        </select>
        <div className="toolbar-stat">
          <strong>{filteredUsers.length.toLocaleString()}</strong>
          <span>{t("mobileUsers.shown")}</span>
        </div>
        <div className="toolbar-stat">
          <strong>{summary.newThisWeek.toLocaleString()}</strong>
          <span>{t("mobileUsers.newThisWeek")}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <div className="eyebrow">{t("mobileUsers.tableEyebrow")}</div>
            <h3>{t("mobileUsers.tableTitle")}</h3>
          </div>
          <span className="count-pill">
            {filteredUsers.length} / {users.length} {t("mobileUsers.users")}
          </span>
        </div>

        {isLoading ? (
          <div className="empty-state">{t("common.loading")}</div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-state">{t("mobileUsers.empty")}</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("mobileUsers.no")}</th>
                  <th>{t("mobileUsers.user")}</th>
                  <th>{t("mobileUsers.registrationMethod")}</th>
                  <th>{t("mobileUsers.status")}</th>
                  <th>{t("mobileUsers.registeredAt")}</th>
                  <th>{t("mobileUsers.applications")}</th>
                  <th>{t("mobileUsers.lastActivity")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user, index) => {
                  const stats = statsByUser.get(user.id) ?? emptyStats();
                  return (
                    <tr key={user.id}>
                      <td className="row-index">{index + 1}</td>
                      <td>
                        <strong>{user.display_name || user.full_name || user.email || t("mobileUsers.unknownUser")}</strong>
                        <div className="table-subtext">{user.email || t("mobileUsers.noEmail")}</div>
                        <div className="table-subtext">{shortID(user.id)}</div>
                        {user.phone ? <div className="table-subtext">{user.phone}</div> : null}
                      </td>
                      <td>
                        <span className={`status-pill ${user.oauth_provider ? "active" : ""}`}>
                          {providerLabel((user.oauth_provider ?? "unknown") as ProviderFilter, t)}
                        </span>
                        {user.oauth_subject ? <div className="table-subtext">{shortID(user.oauth_subject)}</div> : null}
                      </td>
                      <td>
                        <span className={`status-pill ${user.status}`}>{t(`statuses.${user.status}`)}</span>
                      </td>
                      <td>{formatDate(user.created_at)}</td>
                      <td>
                        <strong>{stats.totalApplications}</strong>
                        <div className="table-subtext">
                          {stats.activeApplications} {t("mobileUsers.activeApplications")}
                        </div>
                        {stats.latestApplicationStatus ? (
                          <div className="table-subtext">{applicationStatusLabel(stats.latestApplicationStatus)}</div>
                        ) : null}
                      </td>
                      <td>
                        {stats.latestActivityAt ? formatDate(stats.latestActivityAt) : t("common.na")}
                        {stats.firstApplicationAt ? (
                          <div className="table-subtext">
                            {t("mobileUsers.firstApplied")} {formatDate(stats.firstApplicationAt)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="eyebrow">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function buildStats(applications: ApplicationLite[]) {
  const statsByUser = new Map<string, MobileUserStats>();
  applications.forEach((application) => {
    const stats = statsByUser.get(application.user_id) ?? emptyStats();
    stats.totalApplications += 1;
    if (activeApplicationStatuses.includes(application.status)) {
      stats.activeApplications += 1;
    }
    if (!stats.latestActivityAt || new Date(application.updated_at) > new Date(stats.latestActivityAt)) {
      stats.latestActivityAt = application.updated_at;
      stats.latestApplicationStatus = application.status;
    }
    if (!stats.firstApplicationAt || new Date(application.created_at) < new Date(stats.firstApplicationAt)) {
      stats.firstApplicationAt = application.created_at;
    }
    statsByUser.set(application.user_id, stats);
  });
  return statsByUser;
}

function emptyStats(): MobileUserStats {
  return {
    activeApplications: 0,
    firstApplicationAt: null,
    latestActivityAt: null,
    latestApplicationStatus: null,
    totalApplications: 0
  };
}

function providerLabel(provider: ProviderFilter, t: (key: string) => string) {
  if (provider === "all") return t("mobileUsers.allMethods");
  if (provider === "google") return "Google";
  if (provider === "apple") return "Apple";
  return t("mobileUsers.unknownMethod");
}

function shortID(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function applicationStatusLabel(status: ApplicationStatus) {
  return status.replaceAll("_", " ");
}

function isMobileUserAccount(user: AccountProfile) {
  if (user.is_mobile_user) return true;
  if (user.account_kind === "mobile") return true;
  if (user.oauth_provider === "apple" || user.oauth_provider === "google") return true;
  return !hasVisibleEmail(user);
}

function hasVisibleEmail(user: AccountProfile) {
  return Boolean(user.email?.trim());
}

function shouldRetryWithoutProfileColumns(message?: string) {
  const normalized = message?.toLowerCase() ?? "";
  return (
    normalized.includes("42703") ||
    normalized.includes("account_kind") ||
    normalized.includes("is_mobile_user") ||
    normalized.includes("phone")
  );
}
