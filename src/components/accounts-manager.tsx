"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { roleLabel, statusLabel } from "@/lib/format";
import type { AccountProfile, AccountStatus, AdminRole } from "@/lib/types";

const roles: AdminRole[] = ["super_admin", "admin", "editor", "viewer"];
const statuses: AccountStatus[] = ["active", "pending", "suspended"];

export function AccountsManager({ currentProfile }: { currentProfile: AccountProfile | null }) {
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
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
    setMessage("Account access updated.");
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="eyebrow">Access control</div>
          <h2>Accounts and roles</h2>
        </div>
        <button className="ghost-button" disabled={isLoading} onClick={loadAccounts} type="button">
          <RefreshCcw size={16} />
          Refresh
        </button>
      </div>

      {error ? <div className="message error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {message ? <div className="message" style={{ marginBottom: 14 }}>{message}</div> : null}

      <section className="panel">
        <div className="section-title">
          <div>
            <div className="eyebrow">Role matrix</div>
            <h3>Assign least-privilege access</h3>
          </div>
          <span className="count-pill">{accounts.length} accounts</span>
        </div>

        <div className="accounts-list">
          {accounts.map((account) => {
            const isSelf = account.id === currentProfile?.id;
            const canAssignSuperAdmin = currentProfile?.role === "super_admin" || account.role !== "super_admin";

            return (
              <div className="account-row" key={account.id}>
                <div>
                  <strong>{account.full_name || account.email}</strong>
                  <p className="muted">{account.email}</p>
                </div>

                <label className="field">
                  <span>Role</span>
                  <select
                    value={account.role}
                    onChange={(event) => updateDraft(account.id, { role: event.target.value as AdminRole })}
                  >
                    {roles
                      .filter((role) => currentProfile?.role === "super_admin" || role !== "super_admin")
                      .map((role) => (
                        <option disabled={!canAssignSuperAdmin && role === "super_admin"} key={role} value={role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="field">
                  <span>Status</span>
                  <select
                    value={account.status}
                    onChange={(event) => updateDraft(account.id, { status: event.target.value as AccountStatus })}
                  >
                    {statuses.map((status) => (
                      <option disabled={isSelf && status !== "active"} key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>

                <button className="button" disabled={savingID === account.id} onClick={() => saveAccount(account)} type="button">
                  <Save size={16} />
                  {savingID === account.id ? "Saving..." : "Save"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
