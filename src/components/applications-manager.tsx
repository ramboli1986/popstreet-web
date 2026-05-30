"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Copy, ExternalLink, Link2, RefreshCcw, X } from "lucide-react";
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

type UnitLite = {
  id: string;
  unit_number: string | null;
  name: string | null;
};

type StatusFilter = "all" | "active" | ApplicationStatus;

const APPLICATION_PROOFS_BUCKET = "application-proofs";
const PROOF_SIGNED_URL_TTL = 60 * 60; // 1 hour

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  ops_in_progress: "Ops working",
  link_ready: "Link ready",
  submitted_to_lo: "Submitted to LO",
  proof_rejected: "Proof rejected",
  under_review: "LO reviewing",
  accepted: "Accepted",
  rejected: "Rejected",
  cashback_pending: "Cashback pending",
  cashback_paid: "Cashback paid",
  cancelled: "Cancelled",
  no_response: "No response"
};

/**
 * Color buckets mirror the iOS app's pill palette family, with finer per-status
 * hues so ops can still scan their queue:
 *   amber   = "in flight, our side"      (submitted, ops_in_progress)
 *   purple  = "user's turn / cashback"   (link_ready, cashback_pending)
 *   blue    = "waiting on LO"            (submitted_to_lo, under_review)
 *   green   = "deal won"                 (accepted, cashback_paid)
 *   gray    = "terminal"                 (rejected, cancelled, no_response)
 */
const STATUS_COLORS: Record<ApplicationStatus, string> = {
  submitted: "#f59e0b",
  ops_in_progress: "#f59e0b",
  link_ready: "#623eeb",
  submitted_to_lo: "#26a3df",
  // proof_rejected = red/pink "needs attention" — user must re-upload, not a
  // terminal rejection.
  proof_rejected: "#dc2626",
  under_review: "#26a3df",
  accepted: "#13a463",
  rejected: "#8a9099",
  cashback_pending: "#ff4260",
  cashback_paid: "#13a463",
  cancelled: "#8a9099",
  no_response: "#8a9099"
};

/**
 * What ops / the system is expected to do next for each status. Surfaced as
 * subtext under the status pill so anyone scanning the list can see what
 * action a row is waiting on without opening the detail drawer.
 */
const STATUS_NEXT_STEPS: Record<ApplicationStatus, string> = {
  submitted: "Email LO to register applicant",
  ops_in_progress: "Paste broker link from LO reply",
  link_ready: "Wait for user to upload submission proof",
  submitted_to_lo: "Verify proof against LO · accept or reject proof",
  proof_rejected: "Wait for user to re-upload a valid screenshot",
  under_review: "Wait for LO decision",
  accepted: "Pay cashback once lease is signed",
  cashback_pending: "Send cashback · mark paid",
  cashback_paid: "Done",
  rejected: "Closed — no further action",
  cancelled: "Closed — no further action",
  no_response: "Closed — no further action"
};

const ACTIVE_STATUSES: ApplicationStatus[] = [
  "submitted",
  "ops_in_progress",
  "link_ready",
  "submitted_to_lo",
  "proof_rejected",
  "under_review",
  "accepted",
  "cashback_pending"
];

/** Filter dropdown: meta options first, then every individual status. */
const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active (open)" },
  { value: "all", label: "All statuses" },
  { value: "submitted", label: "Submitted" },
  { value: "ops_in_progress", label: "Ops working" },
  { value: "link_ready", label: "Link ready" },
  { value: "submitted_to_lo", label: "Submitted to LO" },
  { value: "proof_rejected", label: "Proof rejected" },
  { value: "under_review", label: "LO reviewing" },
  { value: "accepted", label: "Accepted" },
  { value: "cashback_pending", label: "Cashback pending" },
  { value: "cashback_paid", label: "Cashback paid" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_response", label: "No response" }
];

function StatusPill({ status }: { status: ApplicationStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color,
        background: `${color}20`,
        padding: "4px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap"
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ApplicationsManager({ profile }: ApplicationsManagerProps) {
  const canEdit = canEditInventory(profile?.role, profile?.account_kind, profile?.status);

  const [applications, setApplications] = useState<Application[]>([]);
  const [applicants, setApplicants] = useState<Map<string, ApplicantLite>>(new Map());
  const [buildings, setBuildings] = useState<Map<string, BuildingLite>>(new Map());
  const [units, setUnits] = useState<Map<string, UnitLite>>(new Map());
  const [proofURLs, setProofURLs] = useState<Map<string, string>>(new Map());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
    const unitIds = Array.from(
      new Set(rows.map((r) => r.unit_id).filter((id): id is string => Boolean(id)))
    );
    const proofPaths = rows
      .map((r) => r.submission_proof_url)
      .filter((path): path is string => Boolean(path && path.trim().length > 0));

    const [profileResult, buildingResult, unitResult, signedUrlResult] = await Promise.all([
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
            .in("id", buildingIds),
      unitIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase.from("units").select("id, unit_number, name").in("id", unitIds),
      proofPaths.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase.storage.from(APPLICATION_PROOFS_BUCKET).createSignedUrls(proofPaths, PROOF_SIGNED_URL_TTL)
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

    if (unitResult.error) {
      setErrorMessage(unitResult.error.message);
    } else {
      setUnits(new Map((unitResult.data as UnitLite[]).map((u) => [u.id, u])));
    }

    if (signedUrlResult.error) {
      console.warn("Failed to sign application proof URLs", signedUrlResult.error);
      setProofURLs(new Map());
    } else {
      const entries = (signedUrlResult.data ?? []).flatMap((r): [string, string][] => {
        if (r.error || !r.signedUrl || !r.path) return [];
        return [[r.path, r.signedUrl]];
      });
      setProofURLs(new Map(entries));
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

  const selectedApplication = useMemo(
    () => (selectedId ? applications.find((a) => a.id === selectedId) ?? null : null),
    [selectedId, applications]
  );

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

  async function rejectProof(application: Application) {
    if (!application.submission_proof_url) {
      setErrorMessage("No proof has been uploaded for this application yet.");
      return;
    }
    const reason = window.prompt(
      "Why is this proof being rejected? (shown to the user so they can re-upload a better screenshot)",
      application.proof_rejection_reason ?? ""
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setErrorMessage("Rejection reason is required so the user knows what to fix.");
      return;
    }
    // Bounce just the proof — keep submission_proof_url around so ops can
    // still review what the user originally sent, but flip the status so the
    // app surfaces a re-upload CTA.
    await patch(application.id, {
      status: "proof_rejected",
      proof_rejection_reason: trimmed,
      proof_rejected_at: new Date().toISOString()
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

  function renderDrawerActions(application: Application) {
    const isBusy = busyId === application.id;
    const disabled = !canEdit || isBusy;

    /**
     * Per-status workflow actions. "Mark ops working" was removed — ops
     * goes directly from `submitted` to pasting the broker link. The
     * "Mark user submitted" affordance also no longer lives here because
     * users flip that themselves via in-app screenshot upload.
     */
    switch (application.status) {
      case "submitted":
      case "ops_in_progress":
        return (
          <>
            <button className="button compact-button" disabled={disabled} onClick={() => pasteLink(application)} type="button">
              <Link2 size={14} />
              Paste broker link
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "cancelled")} type="button">
              Cancel application
            </button>
          </>
        );
      case "link_ready":
        return (
          <>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => pasteLink(application)} type="button">
              <Link2 size={14} />
              Update broker link
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "no_response")} type="button">
              Mark no response
            </button>
          </>
        );
      case "submitted_to_lo":
        return (
          <>
            <button className="button compact-button" disabled={disabled} onClick={() => markStatus(application, "accepted", { accepted_at: new Date().toISOString() })} type="button">
              Mark accepted
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "under_review")} type="button">
              Mark under review
            </button>
            {application.submission_proof_url ? (
              <button
                className="danger-ghost-button compact-button"
                disabled={disabled}
                onClick={() => rejectProof(application)}
                type="button"
              >
                Reject proof
              </button>
            ) : null}
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "rejected")} type="button">
              Mark rejected
            </button>
          </>
        );
      case "proof_rejected":
        return (
          <>
            <button
              className="ghost-button compact-button"
              disabled={disabled}
              onClick={() => rejectProof(application)}
              type="button"
            >
              Update rejection reason
            </button>
            <button
              className="ghost-button compact-button"
              disabled={disabled}
              onClick={() => markStatus(application, "cancelled")}
              type="button"
            >
              Cancel application
            </button>
          </>
        );
      case "under_review":
        return (
          <>
            <button className="button compact-button" disabled={disabled} onClick={() => markStatus(application, "accepted", { accepted_at: new Date().toISOString() })} type="button">
              Mark accepted
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "rejected")} type="button">
              Mark rejected
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "no_response")} type="button">
              Mark no response
            </button>
          </>
        );
      case "accepted":
        return (
          <>
            <button className="button compact-button" disabled={disabled} onClick={() => setCashbackAndPay(application)} type="button">
              Pay cashback
            </button>
            <button className="ghost-button compact-button" disabled={disabled} onClick={() => markStatus(application, "cashback_pending")} type="button">
              Mark cashback pending
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
        return <span className="table-subtext">No actions available for this status.</span>;
    }
  }

  return (
    <div className="applications-page">
      <div className="page-hero">
        <div>
          <div className="eyebrow">Applications</div>
          <h1>Broker pipeline</h1>
          <p>One row per user × building. Click any row to view details and move status.</p>
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

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          margin: "14px 0"
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: "var(--muted)"
          }}
        >
          Status
          <select
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "white",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink)",
              textTransform: "none",
              letterSpacing: 0,
              minWidth: 200
            }}
            value={statusFilter}
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {filteredApplications.length} / {applications.length} shown
        </span>
      </div>

      {isLoading ? (
        <div className="empty-state">Loading applications...</div>
      ) : filteredApplications.length === 0 ? (
        <div className="empty-state">
          <strong>No applications match this filter.</strong>
          <p>Try changing the status filter or pull again with refresh.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Status</th>
                <th>Building</th>
                <th>Applicant</th>
                <th>Unit</th>
                <th>Proof</th>
                <th>Cashback</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredApplications.map((application, index) => {
                const applicant = applicants.get(application.user_id);
                const building = buildings.get(application.building_id);
                const unit = application.unit_id ? units.get(application.unit_id) : undefined;
                const applicantName =
                  applicant?.display_name?.trim() ||
                  applicant?.full_name?.trim() ||
                  "Applicant";
                const contactBits = [applicant?.email, applicant?.phone].filter(Boolean).join(" · ");
                const isSelected = selectedId === application.id;

                return (
                  <tr
                    className={`clickable-row ${isSelected ? "selected" : ""}`}
                    key={application.id}
                    onClick={() => setSelectedId(application.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(application.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="row-index">{index + 1}</td>
                    <td>
                      <StatusPill status={application.status} />
                      <div
                        className="table-subtext"
                        style={{ marginTop: 4, maxWidth: 220, lineHeight: 1.35 }}
                      >
                        → {STATUS_NEXT_STEPS[application.status]}
                      </div>
                    </td>
                    <td>
                      <span className="table-primary-text">{building?.name ?? "Building missing"}</span>
                      {building ? (
                        <div className="table-subtext">
                          {building.city}, {building.state}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="table-primary-text">{applicantName}</span>
                      {contactBits ? <div className="table-subtext">{contactBits}</div> : null}
                      {applicant?.oauth_provider ? (
                        <div className="table-subtext" style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
                          {applicant.oauth_provider}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {unit?.unit_number || unit?.name ? (
                        <span className="table-primary-text">{unit.unit_number ?? unit.name}</span>
                      ) : (
                        <span className="table-subtext">—</span>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const proofPath = application.submission_proof_url;
                        if (!proofPath) {
                          return <span className="table-subtext">—</span>;
                        }
                        const thumbURL = proofURLs.get(proofPath);
                        if (!thumbURL) {
                          return (
                            <span style={{ color: "#13a463", fontWeight: 600, fontSize: 12 }}>
                              Uploaded
                            </span>
                          );
                        }
                        return (
                          <div
                            style={{
                              width: 64,
                              height: 64,
                              borderRadius: 10,
                              overflow: "hidden",
                              border: "1px solid var(--line)",
                              background: "var(--surface-muted)"
                            }}
                          >
                            <Image
                              alt="Submission proof preview"
                              height={128}
                              src={thumbURL}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                              unoptimized
                              width={128}
                            />
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      {application.cashback_amount_cents ? (
                        <>
                          <span className="table-primary-text">
                            {formatMoneyFromCents(application.cashback_amount_cents)}
                          </span>
                          {application.cashback_paid_at ? (
                            <div className="table-subtext">paid {formatDate(application.cashback_paid_at)}</div>
                          ) : null}
                        </>
                      ) : (
                        <span className="table-subtext">—</span>
                      )}
                    </td>
                    <td>{formatDate(application.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedApplication ? (
        <ApplicationDrawer
          actions={renderDrawerActions(selectedApplication)}
          applicant={applicants.get(selectedApplication.user_id)}
          application={selectedApplication}
          building={buildings.get(selectedApplication.building_id)}
          isBusy={busyId === selectedApplication.id}
          onClose={() => setSelectedId(null)}
          proofURL={
            selectedApplication.submission_proof_url
              ? proofURLs.get(selectedApplication.submission_proof_url) ?? null
              : null
          }
          unit={selectedApplication.unit_id ? units.get(selectedApplication.unit_id) : undefined}
        />
      ) : null}
    </div>
  );
}

function ApplicationDrawer({
  application,
  applicant,
  building,
  unit,
  proofURL,
  actions,
  isBusy,
  onClose
}: {
  application: Application;
  applicant: ApplicantLite | undefined;
  building: BuildingLite | undefined;
  unit: UnitLite | undefined;
  proofURL: string | null;
  actions: React.ReactNode;
  isBusy: boolean;
  onClose: () => void;
}) {
  const applicantName =
    applicant?.display_name?.trim() || applicant?.full_name?.trim() || "Applicant";

  return (
    <div className="drawer-backdrop" onMouseDown={onClose} role="presentation">
      <aside
        aria-modal="true"
        className="side-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="drawer-header">
          <div>
            <div className="eyebrow">Application</div>
            <h3>{building?.name ?? "Building missing"}</h3>
            <div className="drawer-header-subtitle">
              {applicantName}
              {applicant?.email ? <> · {applicant.email}</> : null}
            </div>
          </div>
          <div className="drawer-header-actions">
            <StatusPill status={application.status} />
            <button className="icon-button" onClick={onClose} title="Close" type="button">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="drawer-body" style={{ display: "grid", gap: 18 }}>
          <Section title="Applicant">
            <KV label="Name" value={applicantName} />
            <KV label="Email" value={applicant?.email || "—"} />
            <KV label="Phone" value={applicant?.phone || "—"} />
            <KV label="Signed in via" value={applicant?.oauth_provider?.toUpperCase() || "—"} />
            <KV label="User ID" value={application.user_id} mono />
          </Section>

          <Section title="Listing">
            <KV label="Building" value={building?.name || "—"} />
            <KV
              label="Address"
              value={
                building
                  ? building.full_address || `${building.address ?? ""}${building.city ? `, ${building.city}` : ""}${building.state ? `, ${building.state}` : ""}`
                  : "—"
              }
            />
            <KV label="Unit" value={unit?.unit_number || unit?.name || "—"} />
            <KV
              label="App fee"
              value={application.fee_cents ? formatMoneyFromCents(application.fee_cents) : "—"}
            />
          </Section>

          <Section title="Broker link">
            {application.broker_link ? (
              <>
                <div
                  style={{
                    fontSize: 12,
                    background: "var(--brand-soft)",
                    padding: "10px 12px",
                    borderRadius: 10,
                    wordBreak: "break-all",
                    color: "var(--ink)"
                  }}
                >
                  {application.broker_link}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <a
                    className="mini-action"
                    href={application.broker_link}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink size={14} />
                    Open
                  </a>
                  <button
                    className="mini-action"
                    onClick={() => {
                      if (application.broker_link) {
                        void navigator.clipboard.writeText(application.broker_link);
                      }
                    }}
                    type="button"
                  >
                    <Copy size={14} />
                    Copy
                  </button>
                </div>
                {application.broker_link_sent_at ? (
                  <div className="table-subtext" style={{ marginTop: 6 }}>
                    Sent to user {formatDate(application.broker_link_sent_at)}
                  </div>
                ) : null}
              </>
            ) : (
              <span className="table-subtext">No broker link yet. Paste one from the LO reply email below.</span>
            )}
          </Section>

          <Section title="Submission proof">
            {application.status === "proof_rejected" ? (
              <div
                style={{
                  border: "1px solid rgba(220, 38, 38, 0.25)",
                  background: "rgba(220, 38, 38, 0.08)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  marginBottom: 10,
                  display: "grid",
                  gap: 6
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: "#dc2626" }}>
                  Rejected
                  {application.proof_rejected_at ? (
                    <span style={{ marginLeft: 6, color: "#dc2626", opacity: 0.7, fontWeight: 600 }}>
                      · {formatDate(application.proof_rejected_at)}
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                  {application.proof_rejection_reason?.trim() || "No reason given."}
                </div>
                <div className="table-subtext">
                  User will see this reason and can upload a new screenshot.
                </div>
              </div>
            ) : null}
            {proofURL ? (
              <>
                <div
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "var(--surface-muted)"
                  }}
                >
                  <Image
                    alt="Application submission proof"
                    height={1200}
                    src={proofURL}
                    style={{ width: "100%", height: "auto", display: "block" }}
                    unoptimized
                    width={800}
                  />
                </div>
                {application.submission_proof_uploaded_at ? (
                  <div className="table-subtext" style={{ marginTop: 6 }}>
                    Uploaded {formatDate(application.submission_proof_uploaded_at)}
                  </div>
                ) : null}
              </>
            ) : application.submission_proof_url ? (
              <span className="table-subtext">Uploaded — preview unavailable.</span>
            ) : (
              <span className="table-subtext">
                User hasn&apos;t uploaded a confirmation screenshot yet.
              </span>
            )}
          </Section>

          <Section title="Cashback">
            <KV
              label="Amount"
              value={
                application.cashback_amount_cents
                  ? formatMoneyFromCents(application.cashback_amount_cents)
                  : "—"
              }
            />
            <KV
              label="Paid at"
              value={application.cashback_paid_at ? formatDate(application.cashback_paid_at) : "—"}
            />
          </Section>

          <Section title="Timeline">
            <KV label="Created" value={formatDate(application.created_at)} />
            <KV label="Updated" value={formatDate(application.updated_at)} />
            <KV
              label="Broker link sent"
              value={application.broker_link_sent_at ? formatDate(application.broker_link_sent_at) : "—"}
            />
            <KV
              label="Submitted to LO"
              value={application.submitted_to_lo_at ? formatDate(application.submitted_to_lo_at) : "—"}
            />
            <KV
              label="Accepted"
              value={application.accepted_at ? formatDate(application.accepted_at) : "—"}
            />
          </Section>

          {application.notes ? (
            <Section title="Notes">
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink)",
                  background: "var(--surface-muted)",
                  padding: "10px 12px",
                  borderRadius: 10,
                  whiteSpace: "pre-wrap"
                }}
              >
                {application.notes}
              </div>
            </Section>
          ) : null}

          <Section title="Actions">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{actions}</div>
            {isBusy ? (
              <div className="table-subtext" style={{ marginTop: 6 }}>
                Saving…
              </div>
            ) : null}
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: "var(--muted)"
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 6 }}>{children}</div>
    </section>
  );
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 12,
        alignItems: "baseline",
        fontSize: 13
      }}
    >
      <span className="table-subtext">{label}</span>
      <span
        style={{
          color: "var(--ink)",
          fontFamily: mono ? "var(--font-mono, ui-monospace, SFMono-Regular)" : undefined,
          fontSize: mono ? 12 : 13,
          wordBreak: "break-all"
        }}
      >
        {value}
      </span>
    </div>
  );
}
