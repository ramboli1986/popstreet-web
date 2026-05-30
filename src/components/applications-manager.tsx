"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ExternalLink, Image as ImageIcon, Link2, RefreshCcw } from "lucide-react";
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
  const [units, setUnits] = useState<Map<string, UnitLite>>(new Map());
  const [proofURLs, setProofURLs] = useState<Map<string, string>>(new Map());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewProofURL, setPreviewProofURL] = useState<string | null>(null);

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
      // Signed-URL failures are non-fatal — fall back to the plain "uploaded"
      // indicator without a preview.
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
      case "ops_in_progress":
        // No "Mark ops working" anymore — ops goes directly from "submitted"
        // to pasting the broker link.
        return (
          <>
            <button className="mini-action" disabled={disabled} onClick={() => pasteLink(application)} type="button">
              <Link2 size={14} />
              Paste link
            </button>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "cancelled")} type="button">
              Cancel
            </button>
          </>
        );
      case "link_ready":
        // User now self-reports submission via in-app screenshot upload, which
        // flips the row to `submitted_to_lo` automatically. Ops only edits the
        // link here.
        return (
          <button className="mini-action" disabled={disabled} onClick={() => pasteLink(application)} type="button">
            <Link2 size={14} />
            Update link
          </button>
        );
      case "submitted_to_lo":
        return (
          <>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "under_review")} type="button">
              Under review
            </button>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "accepted", { accepted_at: new Date().toISOString() })} type="button">
              Accepted
            </button>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "rejected")} type="button">
              Rejected
            </button>
          </>
        );
      case "under_review":
        return (
          <>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "accepted", { accepted_at: new Date().toISOString() })} type="button">
              Accepted
            </button>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "rejected")} type="button">
              Rejected
            </button>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "no_response")} type="button">
              No response
            </button>
          </>
        );
      case "accepted":
        return (
          <>
            <button className="mini-action" disabled={disabled} onClick={() => markStatus(application, "cashback_pending")} type="button">
              Cashback pending
            </button>
            <button className="mini-action" disabled={disabled} onClick={() => setCashbackAndPay(application)} type="button">
              Pay cashback
            </button>
          </>
        );
      case "cashback_pending":
        return (
          <button className="mini-action" disabled={disabled} onClick={() => setCashbackAndPay(application)} type="button">
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
                <th>Link</th>
                <th>Cashback</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredApplications.map((application, index) => {
                const applicant = applicants.get(application.user_id);
                const building = buildings.get(application.building_id);
                const unit = application.unit_id ? units.get(application.unit_id) : undefined;
                const color = STATUS_COLORS[application.status];
                const proofURL = application.submission_proof_url
                  ? proofURLs.get(application.submission_proof_url) ?? null
                  : null;
                const applicantName =
                  applicant?.display_name?.trim() ||
                  applicant?.full_name?.trim() ||
                  "Applicant";
                const contactBits = [applicant?.email, applicant?.phone].filter(Boolean).join(" · ");

                return (
                  <tr key={application.id}>
                    <td className="row-index">{index + 1}</td>
                    <td>
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
                        {STATUS_LABELS[application.status]}
                      </span>
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
                      {application.submission_proof_url ? (
                        proofURL ? (
                          <button
                            className="mini-action"
                            onClick={() => setPreviewProofURL(proofURL)}
                            type="button"
                            title={
                              application.submission_proof_uploaded_at
                                ? `Uploaded ${formatDate(application.submission_proof_uploaded_at)}`
                                : "View screenshot"
                            }
                          >
                            <ImageIcon size={14} />
                            View
                          </button>
                        ) : (
                          <span className="table-subtext">Uploaded</span>
                        )
                      ) : (
                        <span className="table-subtext">—</span>
                      )}
                    </td>
                    <td>
                      {application.broker_link ? (
                        <a
                          className="table-primary-link"
                          href={application.broker_link}
                          onClick={(event) => event.stopPropagation()}
                          rel="noreferrer"
                          target="_blank"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            maxWidth: 180,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          <ExternalLink size={12} />
                          Open
                        </a>
                      ) : (
                        <span className="table-subtext">—</span>
                      )}
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
                    <td>
                      <div className="row-actions">{renderActions(application)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {previewProofURL ? (
        <div
          onClick={() => setPreviewProofURL(null)}
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 15, 23, 0.72)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
            padding: 24
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            style={{
              background: "white",
              borderRadius: 18,
              padding: 16,
              maxWidth: "min(720px, 90vw)",
              maxHeight: "85vh",
              overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.30)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>Submission screenshot</strong>
              <button className="mini-action" onClick={() => setPreviewProofURL(null)} type="button">
                Close
              </button>
            </div>
            <Image
              alt="Application submission proof"
              height={1200}
              src={previewProofURL}
              style={{ width: "100%", height: "auto", borderRadius: 10, display: "block" }}
              unoptimized
              width={800}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
