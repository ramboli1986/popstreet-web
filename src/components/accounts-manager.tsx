"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { AccountKind, AccountProfile, AccountStatus, AdminRole } from "@/lib/types";

const roles: AdminRole[] = ["super_admin", "admin", "editor", "viewer"];
const statuses: AccountStatus[] = ["active", "pending", "suspended"];

export function AccountsManager({ currentProfile }: { currentProfile: AccountProfile | null }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingID, setSavingID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAccounts() {
    setIsLoading(true);
    setError(null);

    const result = await supabase
      .from("account_profiles")
      .select("*")
      .eq("account_kind", "admin")
      .order("created_at", { ascending: false });

    let rows = result.data as AccountProfile[] | null;
    let loadError = result.error;

    if (loadError && shouldRetryWithoutAccountKind(loadError.message)) {
      const fallback = await supabase
        .from("account_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      rows = fallback.data as AccountProfile[] | null;
      loadError = fallback.error;
    }

    setIsLoading(false);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setAccounts((rows ?? []).filter(isAdminAccount));
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
            {accounts.length} {t("accounts.accounts")}
          </span>
        </div>

        <div className="accounts-list">
          {accounts.map((account) => {
            const isSelf = account.id === currentProfile?.id;
            const kind = accountKind(account);
            const canEditAccount = isAdminAccount(account);
            const canAssignSuperAdmin = currentProfile?.role === "super_admin" || account.role !== "super_admin";

            return (
              <div className="account-row" key={account.id}>
                <div>
                  <strong>{account.full_name || account.display_name || account.email || t("accounts.unknownUser")}</strong>
                  <p className="muted">{account.email || t("accounts.noEmail")}</p>
                  <span className="status-pill active">{t(kind === "admin" ? "accounts.adminAccount" : "accounts.mobileUser")}</span>
                </div>

                <label className="field">
                  <span>{t("accounts.role")}</span>
                  <select
                    disabled={!canEditAccount}
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
                    disabled={!canEditAccount}
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

                <button className="button" disabled={!canEditAccount || savingID === account.id} onClick={() => saveAccount(account)} type="button">
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
  if (account.account_kind) return account.account_kind;
  if (!hasVisibleEmail(account) || account.oauth_provider) return "mobile";
  return "admin";
}

function isAdminAccount(account: AccountProfile) {
  return accountKind(account) === "admin" && hasVisibleEmail(account);
}

function hasVisibleEmail(account: AccountProfile) {
  return Boolean(account.email?.trim());
}

function shouldRetryWithoutAccountKind(message?: string) {
  const normalized = message?.toLowerCase() ?? "";
  return normalized.includes("42703") || normalized.includes("account_kind");
}
