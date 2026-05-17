"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { AccountKind, AccountProfile, AccountStatus, AdminRole } from "@/lib/types";

const roles: AdminRole[] = ["super_admin", "admin", "editor", "viewer"];
const statuses: AccountStatus[] = ["active", "pending", "suspended"];
const accountKindFilters: Array<AccountKind | "all"> = ["admin", "mobile", "all"];

export function AccountsManager({ currentProfile }: { currentProfile: AccountProfile | null }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [kindFilter, setKindFilter] = useState<AccountKind | "all">("admin");
  const [isLoading, setIsLoading] = useState(false);
  const [savingID, setSavingID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAccounts() {
    setIsLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from("account_profiles")
      .select("*")
      .order("created_at", { ascending: false });

    setIsLoading(false);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setAccounts((data ?? []) as AccountProfile[]);
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  function updateDraft(id: string, patch: Partial<AccountProfile>) {
    setAccounts((current) => current.map((account) => (account.id === id ? { ...account, ...patch } : account)));
  }

  async function saveAccount(account: AccountProfile) {
    if (accountKind(account) !== "admin") {
      setError(t("accounts.mobileLocked"));
      return;
    }

    setSavingID(account.id);
    setError(null);
    setMessage(null);

    const { data, error: saveError } = await supabase.rpc("update_account_access", {
      target_user_id: account.id,
      next_role: account.role,
      next_status: account.status
    });

    setSavingID(null);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    updateDraft(account.id, data as AccountProfile);
    setMessage(t("accounts.updated"));
  }

  const filteredAccounts = useMemo(() => {
    if (kindFilter === "all") return accounts;
    return accounts.filter((account) => accountKind(account) === kindFilter);
  }, [accounts, kindFilter]);

  const kindCounts = useMemo(() => {
    const counts = new Map<AccountKind | "all", number>([["all", accounts.length]]);
    counts.set("admin", accounts.filter((account) => accountKind(account) === "admin").length);
    counts.set("mobile", accounts.filter((account) => accountKind(account) === "mobile").length);
    return counts;
  }, [accounts]);

  return (
    <>
      <div className="content-header">
        <div>
          <div className="eyebrow">{t("accounts.eyebrow")}</div>
          <h2>{t("accounts.title")}</h2>
        </div>
        <button className="ghost-button" disabled={isLoading} onClick={loadAccounts} type="button">
          <RefreshCcw size={16} />
          {t("common.refresh")}
        </button>
      </div>

      {error ? <div className="message error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {message ? <div className="message" style={{ marginBottom: 14 }}>{message}</div> : null}

      <section className="panel">
        <div className="section-title">
          <div>
            <div className="eyebrow">{t("accounts.roleMatrix")}</div>
            <h3>{t("accounts.leastPrivilege")}</h3>
          </div>
          <span className="count-pill">
            {filteredAccounts.length} / {accounts.length} {t("accounts.accounts")}
          </span>
        </div>

        <div className="filter-row" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 14px" }}>
          {accountKindFilters.map((option) => {
            const active = option === kindFilter;
            return (
              <button
                className={`ghost-button compact-button ${active ? "active" : ""}`}
                key={option}
                onClick={() => setKindFilter(option)}
                style={
                  active
                    ? { background: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)" }
                    : undefined
                }
                type="button"
              >
                {accountKindFilterLabel(option, t)}
                <span style={{ marginLeft: 6, opacity: 0.6 }}>{kindCounts.get(option) ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div className="accounts-list">
          {filteredAccounts.map((account) => {
            const isSelf = account.id === currentProfile?.id;
            const kind = accountKind(account);
            const isAdminAccount = kind === "admin";
            const canAssignSuperAdmin = currentProfile?.role === "super_admin" || account.role !== "super_admin";

            return (
              <div className="account-row" key={account.id}>
                <div>
                  <strong>{account.full_name || account.display_name || account.email || t("accounts.unknownUser")}</strong>
                  <p className="muted">{account.email || t("accounts.noEmail")}</p>
                  <span className={`status-pill ${kind === "admin" ? "active" : ""}`}>
                    {t(kind === "admin" ? "accounts.adminAccount" : "accounts.mobileUser")}
                  </span>
                </div>

                <label className="field">
                  <span>{t("accounts.role")}</span>
                  <select
                    disabled={!isAdminAccount}
                    value={account.role}
                    onChange={(event) => updateDraft(account.id, { role: event.target.value as AdminRole })}
                  >
                    {roles
                      .filter((role) => currentProfile?.role === "super_admin" || role !== "super_admin")
                      .map((role) => (
                        <option disabled={!canAssignSuperAdmin && role === "super_admin"} key={role} value={role}>
                          {t(`roles.${role}`)}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="field">
                  <span>{t("accounts.status")}</span>
                  <select
                    disabled={!isAdminAccount}
                    value={account.status}
                    onChange={(event) => updateDraft(account.id, { status: event.target.value as AccountStatus })}
                  >
                    {statuses.map((status) => (
                      <option disabled={isSelf && status !== "active"} key={status} value={status}>
                        {t(`statuses.${status}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <button className="button" disabled={!isAdminAccount || savingID === account.id} onClick={() => saveAccount(account)} type="button">
                  <Save size={16} />
                  {savingID === account.id ? t("common.saving") : t("common.save")}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function accountKind(account: AccountProfile): AccountKind {
  return account.account_kind ?? "admin";
}

function accountKindFilterLabel(kind: AccountKind | "all", t: (key: string) => string) {
  if (kind === "all") return t("accounts.allAccounts");
  if (kind === "mobile") return t("accounts.mobileUsers");
  return t("accounts.adminAccounts");
}
