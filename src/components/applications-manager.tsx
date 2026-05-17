"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Link2, RefreshCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { canEditInventory, formatDate, formatMoneyFromCents } from "@/lib/format";
import type { AccountProfile, Application, ApplicationStatus, Building } from "@/lib/types";

type ApplicationsManagerProps = {
  profile: AccountProfile | null;
};

type ApplicantLite = Pick<AccountProfile, "id" | "email" | "full_name"> & {
  display_name: string | null;
  phone: string | null;
  oauth_provider: string | null;
};

type BuildingLite = Pick<Building, "id" | "name" | "address" | "full_address" | "city" | "state">;

type StatusFilter = "all" | "active" | ApplicationStatus;

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  ops_in_progress: "Ops working",
  link_ready: "Link ready",
  submitted_to_lo: "Submitted to LO",
  under_review: "LO reviewing",
  accepted: "Accepted",
  rejected: "Rejected",
  cashback_pending: "Cashback pending",
  cashback_paid: "Cashback paid",
  cancelled: "Cancelled",
  no_response: "No response"
};

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  submitted: "#f59e0b",
  ops_in_progress: "#f59e0b",
  link_ready: "#623eeb",
  submitted_to_lo: "#26a3df",
  under_review: "#26a3df",
  accepted: "#13a463",
  rejected: "#8a9099",
  cashback_pending: "#ff4260",
  cashback_paid: "#13a463",
  cancelled: "#8a9099",
  no_response: "#8a9099"
};

const ACTIVE_STATUSES: ApplicationStatus[] = [
  "submitted",
  "ops_in_progress",
  "link_ready",
  "submitted_to_lo",
  "under_review",
  "accepted",
  "cashback_pending"
];

const FILTER_ORDER: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  { value: "submitted", label: "New" },
  { value: "ops_in_progress", label: "Ops working" },
  { value: "link_ready", label: "Link sent" },
  { value: "submitted_to_lo", label: "Submitted" },
  { value: "under_review", label: "Reviewing" },
  { value: "accepted", label: "Accepted" },
  { value: "cashback_pending", label: "Cashback pending" }
];

export function ApplicationsManager({ profile }: ApplicationsManagerProps) {
  const canEdit = canEditInventory(profile?.role, profile?.account_kind, profile?.status);

  const [applications, setApplications] = useState<Application[]>([]);
  const [applicants, setApplicants] = useState<Map<string, ApplicantLite>>(new Map());
  const [buildings, setBuildings] = useState<Map<string, BuildingLite>>(new Map());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const { data: applicationRows, error: applicationError } = await supabase
      .from("applications")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (applicationError) {
      setErrorMessage(applicationError.message);
      setIsLoading(false);
      return;
    }

    const rows = (applicationRows ?? []) as Application[];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const buildingIds = Array.from(new Set(rows.map((r) => r.building_id)));

    const [profileResult, buildingResult] = await Promise.all([
      userIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("account_profiles")
            .select("id, email, full_name, display_name, phone, oauth_provider")
            .in("id", userIds),
      buildingIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("buildings")
            .select("id, name, address, full_address, city, state")
            .in("id", buildingIds)
    ]);

    setApplications(rows);

    if (profileResult.error) {
      setErrorMessage(profileResult.error.message);
    } else {
      setApplicants(new Map((profileResult.data as ApplicantLite[]).map((p) => [p.id, p])));
    }

    if (buildingResult.error) {
      setErrorMessage(buildingResult.error.message);
    } else {
      setBuildings(new Map((buildingResult.data as BuildingLite[]).map((b) => [b.id, b])));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredApplications = useMemo(() => {
    if (statusFilter === "all") return applications;
    if (statusFilter === "active") {
      return applications.filter((a) => ACTIVE_STATUSES.includes(a.status));
    }
    return applications.filter((a) => a.status === statusFilter);
  }, [applications, statusFilter]);

  const statusCounts = useMemo(() => {
    const map = new Map<StatusFilter, number>();
    map.set("all", applications.length);
    map.set("active", applications.filter((a) => ACTIVE_STATUSES.includes(a.status)).length);
    applications.forEach((a) => {
      map.set(a.status, (map.get(a.status) ?? 0) + 1);
    });
    return map;
  }, [applications]);

  async function patch(applicationId: string, patchBody: Partial<Application>) {
    if (!canEdit) {
      setErrorMessage("You don't have permission to edit applications.");
      return;
    }
    setBusyId(applicationId);
    setErrorMessage(null);
    const { error } = await supabase
      .from("applications")
      .update(patchBody)
      .eq("id", applicationId);
    setBusyId(null);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    await load();
  }

  async function markStatus(application: Application, next: ApplicationStatus, extra: Partial<Application> = {}) {
    await patch(application.id, { status: next, ...extra });
  }

  async function pasteLink(application: Application) {
    const link = window.prompt(
      "Paste the application URL the leasing office sent for this applicant:",
      application.broker_link ?? ""
    );
    if (!link) return;
    const trimmed = link.trim();
    if (!trimmed) return;
    await patch(application.id, {
      broker_link: trimmed,
      broker_link_sent_at: new Date().toISOString(),
      status: "link_ready"
    });
  }

  async function setCashbackAndPay(application: Application) {
    const raw = window.prompt(
      "Enter cashback amount in USD (e.g. 1500). Leave blank to cancel.",
      application.cashback_amount_cents ? String(application.cashback_amount_cents / 100) : ""
    );
    if (!raw) return;
    const dollars = Number(raw.trim());
    if (!Number.isFinite(dollars) || dollars < 0) {
      setErrorMessage("Cashback must be a non-negative number.");
      return;
    }
    await patch(application.id, {
      cashback_amount_cents: Math.round(dollars * 100),
      cashback_paid_at: new Date().toISOString(),
      status: "cashback_paid"
    });
  }

  function renderActions(application: Application) {
    const isBusy = busyId === application.id;
    const disabled = !canEdit || isBusy;
    switch (application.status) {
      case "submitted":
        return (
          <>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "ops_in_progress")} type="button">
              Mark ops working
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "cancelled")} type="button">
              Cancel
            </button>
          </>
        );
      case "ops_in_progress":
        return (
          <>
            <button className="button compact-button" disabled={disabled} onClick={() => pasteLink(application)} type="button">
              <Link2 size={14} />
              Paste broker link
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "no_response")} type="button">
              No response
            </button>
          </>
        );
      case "link_ready":
        return (
          <>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => pasteLink(application)} type="button">
              Update link
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "submitted_to_lo", { submitted_to_lo_at: new Date().toISOString() })} type="button">
              Mark user submitted
            </button>
          </>
        );
      case "submitted_to_lo":
        return (
          <>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "under_review")} type="button">
              Mark under review
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "accepted", { accepted_at: new Date().toISOString() })} type="button">
              Mark accepted
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "rejected")} type="button">
              Mark rejected
            </button>
          </>
        );
      case "under_review":
        return (
          <>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "accepted", { accepted_at: new Date().toISOString() })} type="button">
              Mark accepted
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "rejected")} type="button">
              Mark rejected
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "no_response")} type="button">
              No response
            </button>
          </>
        );
      case "accepted":
        return (
          <>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "cashback_pending")} type="button">
              Cashback pending
            </button>
            <button className="button compact-button" disabled={disabled} onClick={() => setCashbackAndPay(application)} type="button">
              Pay cashback
            </button>
          </>
        );
      case "cashback_pending":
        return (
          <button className="button compact-button" disabled={disabled} onClick={() => setCashbackAndPay(application)} type="button">
            Pay cashback
          </button>
        );
      default:
        return null;
    }
  }

  return (
    <div className="applications-page">
      <div className="page-hero">
        <div>
          <div className="eyebrow">Applications</div>
          <h1>Broker pipeline</h1>
          <p>One row per user × building. Status moves manually as ops emails the leasing office and gets responses back.</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={load} type="button" disabled={isLoading}>
            <RefreshCcw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {errorMessage ? <div className="message error compact-message">{errorMessage}</div> : null}
      {!canEdit ? <div className="message compact-message">Read-only — editor role or higher can change statuses.</div> : null}

      <div className="filter-row" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" }}>
        {FILTER_ORDER.map((option) => {
          const count = statusCounts.get(option.value) ?? 0;
          const active = option.value === statusFilter;
          return (
            <button
              key={option.value}
              className={`ghost-button compact-button ${active ? "active" : ""}`}
              onClick={() => setStatusFilter(option.value)}
              type="button"
              style={
                active
                  ? { background: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)" }
                  : undefined
              }
            >
              {option.label}
              <span style={{ marginLeft: 6, opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="empty-state">Loading applications...</div>
      ) : filteredApplications.length === 0 ? (
        <div className="empty-state">
          <strong>No applications match this filter.</strong>
          <p>Try changing the filter above or pull again with refresh.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filteredApplications.map((application) => {
            const applicant = applicants.get(application.user_id);
            const building = buildings.get(application.building_id);
            const color = STATUS_COLORS[application.status];
            return (
              <article
                key={application.id}
                style={{
                  background: "white",
                  border: "1px solid var(--line)",
                  borderRadius: 16,
                  padding: 16,
                  boxShadow: "var(--shadow)",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 16,
                  alignItems: "start"
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        color,
                        background: `${color}20`,
                        padding: "4px 10px",
                        borderRadius: 999
                      }}
                    >
                      {STATUS_LABELS[application.status]}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      Created {formatDate(application.created_at)} · Updated {formatDate(application.updated_at)}
                    </span>
                  </div>

                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-display)" }}>
                    {building?.name ?? "Building missing"}
                    <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: 8, fontSize: 13 }}>
                      {building ? `${building.city}, ${building.state}` : ""}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, color: "var(--slate)" }}>
                    <strong style={{ color: "var(--ink)" }}>
                      {applicant?.display_name || applicant?.full_name || "Applicant"}
                    </strong>
                    {applicant?.oauth_provider ? (
                      <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                        {applicant.oauth_provider}
                      </span>
                    ) : null}
                    {applicant?.email ? <span> · {applicant.email}</span> : null}
                    {applicant?.phone ? <span> · {applicant.phone}</span> : null}
                  </div>

                  {application.notes ? (
                    <div style={{ fontSize: 13, color: "var(--slate)", fontStyle: "italic" }}>
                      &quot;{application.notes}&quot;
                    </div>
                  ) : null}

                  {application.broker_link ? (
                    <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                      <ChevronRight size={12} />
                      <a href={application.broker_link} rel="noreferrer" style={{ color: "var(--brand)" }} target="_blank">
                        {application.broker_link}
                      </a>
                    </div>
                  ) : null}

                  {application.cashback_amount_cents ? (
                    <div style={{ fontSize: 13, color: "var(--brand)", fontWeight: 600 }}>
                      Cashback: {formatMoneyFromCents(application.cashback_amount_cents)}
                      {application.cashback_paid_at ? ` · paid ${formatDate(application.cashback_paid_at)}` : null}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 180 }}>{renderActions(application)}</div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
