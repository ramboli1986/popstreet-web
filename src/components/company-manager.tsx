"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction, type UIEvent } from "react";
import { ExternalLink, Plus, Save, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { canEditInventory, canManageAccounts, formatDate, slugify, stringArrayToInput, toStringArray } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { AccountProfile, ManagementCompany } from "@/lib/types";

type CompanyManagerProps = {
  profile: AccountProfile | null;
};

type BuildingCompanyLink = {
  id: string;
  management_company_id: string | null;
};

const companyBatchSize = 25;

export function CompanyManager({ profile }: CompanyManagerProps) {
  const { language, t } = useI18n();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [companies, setCompanies] = useState<ManagementCompany[]>([]);
  const [buildingLinks, setBuildingLinks] = useState<BuildingCompanyLink[]>([]);
  const [draft, setDraft] = useState<ManagementCompany | null>(null);
  const [search, setSearch] = useState("");
  const [visibleCompanyCount, setVisibleCompanyCount] = useState(companyBatchSize);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = canEditInventory(profile?.role, profile?.account_kind, profile?.status);
  const canDelete = canManageAccounts(profile?.role, profile?.account_kind, profile?.status);

  const loadCompanies = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [companyResult, buildingResult] = await Promise.all([
      supabase.from("management_companies").select("*").order("name"),
      supabase.from("buildings").select("id, management_company_id").limit(5000)
    ]);

    setIsLoading(false);

    if (companyResult.error) {
      setError(companyResult.error.message);
      return;
    }

    if (buildingResult.error) {
      setError(buildingResult.error.message);
      return;
    }

    setCompanies((companyResult.data ?? []) as ManagementCompany[]);
    setBuildingLinks((buildingResult.data ?? []) as BuildingCompanyLink[]);
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    setVisibleCompanyCount(companyBatchSize);
  }, [search]);

  const linkedBuildingCounts = useMemo(() => {
    const counts = new Map<string, number>();

    buildingLinks.forEach((building) => {
      if (!building.management_company_id) {
        return;
      }

      counts.set(building.management_company_id, (counts.get(building.management_company_id) ?? 0) + 1);
    });

    return counts;
  }, [buildingLinks]);

  const filteredCompanies = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return companies;
    }

    return companies.filter((company) =>
      [
        company.name,
        company.slug,
        company.website,
        company.unit_count_label,
        company.notes,
        ...company.key_assets
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    );
  }, [companies, search]);

  const visibleCompanies = useMemo(
    () => filteredCompanies.slice(0, visibleCompanyCount),
    [filteredCompanies, visibleCompanyCount]
  );

  function createCompanyDraft() {
    const now = new Date().toISOString();

    setDraft({
      id: `new-${Date.now()}`,
      slug: "new-management-company",
      name: "New Management Company",
      website: null,
      key_assets: [],
      unit_count_label: null,
      estimated_unit_count: null,
      notes: null,
      contact_email: null,
      contact_phone: null,
      created_at: now,
      updated_at: now
    });
  }

  function updateDraft<K extends keyof ManagementCompany>(key: K, value: ManagementCompany[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveCompany() {
    if (!draft || !canEdit) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const payload = companyPayload(draft);
    const isNew = draft.id.startsWith("new-");
    const result = isNew
      ? await supabase.from("management_companies").insert(payload).select("*").single()
      : await supabase.from("management_companies").update(payload).eq("id", draft.id).select("*").single();

    setIsSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    const savedCompany = result.data as ManagementCompany;
    setCompanies((current) => {
      const withoutSaved = current.filter((company) => company.id !== draft.id && company.id !== savedCompany.id);
      return [...withoutSaved, savedCompany].sort((first, second) => first.name.localeCompare(second.name));
    });
    setDraft(null);
    setMessage(isNew ? t("companies.created") : t("companies.saved"));
  }

  async function deleteCompany(company: ManagementCompany) {
    if (!canDelete || company.id.startsWith("new-")) {
      return;
    }

    const linkedCount = linkedBuildingCounts.get(company.id) ?? 0;
    const confirmed = window.confirm(
      `Delete ${company.name}?${linkedCount > 0 ? ` This will unlink ${linkedCount} building${linkedCount === 1 ? "" : "s"}.` : ""}`
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setMessage(null);

    const { error: deleteError } = await supabase.from("management_companies").delete().eq("id", company.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setCompanies((current) => current.filter((item) => item.id !== company.id));
    setBuildingLinks((current) =>
      current.map((building) =>
        building.management_company_id === company.id ? { ...building, management_company_id: null } : building
      )
    );
    setDraft((current) => (current?.id === company.id ? null : current));
    setMessage(t("companies.deleted"));
  }

  return (
    <>
      <div className="page-hero manager-hero">
        <div>
          <div className="eyebrow">{t("companies.eyebrow")}</div>
          <h1>{t("companies.title", { count: companies.length.toLocaleString(locale) })}</h1>
          <p>{t("companies.subtitle")}</p>
        </div>
        <button className="button" disabled={!canEdit} onClick={createCompanyDraft} type="button">
          <Plus size={16} />
          {t("companies.add")}
        </button>
      </div>

      {error ? <div className="message error compact-message">{error}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}

      <section className="toolbar-row">
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder={t("companies.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="toolbar-stat">
          <strong>{filteredCompanies.length}</strong>
          <span>{t("companies.companies")}</span>
        </div>
        <div className="toolbar-stat">
          <strong>{buildingLinks.filter((building) => building.management_company_id).length}</strong>
          <span>{t("companies.linkedBuildings")}</span>
        </div>
      </section>

      <section className="data-panel building-list-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">{t("companies.list")}</div>
            <h3>{t("manager.fastQueryEdit")}</h3>
          </div>
          <span className="count-pill">
            {isLoading ? t("common.loading") : `${companies.length.toLocaleString(locale)} ${t("common.total")}`}
          </span>
        </div>

        {visibleCompanies.length === 0 ? (
          <div className="empty-state">{t("companies.empty")}</div>
        ) : (
          <div
            className="admin-table-wrap"
            onScroll={(event) =>
              handleScrollLoadMore(
                event,
                visibleCompanyCount,
                filteredCompanies.length,
                setVisibleCompanyCount,
                companyBatchSize
              )
            }
          >
            <table className="admin-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>{t("companies.company")}</th>
                  <th>{t("companies.website")}</th>
                  <th>{t("companies.keyAssets")}</th>
                  <th>{t("common.units")}</th>
                  <th>{t("common.buildings")}</th>
                  <th>{t("companies.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleCompanies.map((company, index) => (
                  <tr className="clickable-row" key={company.id} onClick={() => setDraft(company)} tabIndex={0}>
                    <td className="row-index">{index + 1}</td>
                    <td>
                      <button
                        className="table-primary-link"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDraft(company);
                        }}
                        type="button"
                      >
                        {company.name}
                      </button>
                      <div className="table-subtext">{company.slug}</div>
                    </td>
                    <td>
                      {company.website ? (
                        <a className="table-primary-link muted" href={company.website} rel="noreferrer" target="_blank">
                          {t("companies.website")} <ExternalLink size={13} />
                        </a>
                      ) : (
                        <span className="table-subtext">{t("common.na")}</span>
                      )}
                    </td>
                    <td>
                      <span>{company.key_assets.slice(0, 2).join(", ") || t("common.na")}</span>
                      {company.key_assets.length > 2 ? (
                        <div className="table-subtext">
                          {t("companies.more", { count: company.key_assets.length - 2 })}
                        </div>
                      ) : null}
                    </td>
                    <td>{company.unit_count_label ?? company.estimated_unit_count?.toLocaleString(locale) ?? t("common.na")}</td>
                    <td>{linkedBuildingCounts.get(company.id) ?? 0}</td>
                    <td>{formatDate(company.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMoreStatus shown={visibleCompanies.length} total={filteredCompanies.length} />
          </div>
        )}
      </section>

      {draft ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setDraft(null)}>
          <aside className="side-drawer building-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header className="drawer-header">
              <div>
                <div className="eyebrow">Management company</div>
                <h3>{draft.id.startsWith("new-") ? "New company" : draft.name}</h3>
              </div>
              <button className="icon-button" onClick={() => setDraft(null)} title="Close" type="button">
                <X size={16} />
              </button>
            </header>
            <div className="drawer-body">
              <section className="editor-form">
                <div className="form-section-title">Company profile</div>
                <div className="form-grid dense">
                  <InputField disabled={!canEdit} label="Name" value={draft.name} onChange={(value) => updateDraft("name", value)} />
                  <InputField
                    disabled={!canEdit}
                    label="Slug"
                    value={draft.slug}
                    onChange={(value) => updateDraft("slug", slugify(value))}
                  />
                  <InputField
                    disabled={!canEdit}
                    label="Website"
                    value={draft.website ?? ""}
                    onChange={(value) => updateDraft("website", value || null)}
                  />
                  <InputField
                    disabled={!canEdit}
                    label="Unit count label"
                    value={draft.unit_count_label ?? ""}
                    onChange={(value) => updateDraft("unit_count_label", value || null)}
                  />
                  <NumberField
                    disabled={!canEdit}
                    label="Estimated units"
                    value={draft.estimated_unit_count}
                    onChange={(value) => updateDraft("estimated_unit_count", value == null ? null : Math.round(value))}
                  />
                  <InputField
                    disabled={!canEdit}
                    label="Key assets"
                    value={stringArrayToInput(draft.key_assets)}
                    onChange={(value) => updateDraft("key_assets", toStringArray(value))}
                  />
                  <label className="field full">
                    <span>Notes</span>
                    <textarea
                      disabled={!canEdit}
                      value={draft.notes ?? ""}
                      onChange={(event) => updateDraft("notes", event.target.value || null)}
                    />
                  </label>
                </div>

                <div className="form-row sticky-actions">
                  {!draft.id.startsWith("new-") ? (
                    <button className="danger-button" disabled={!canDelete} onClick={() => deleteCompany(draft)} type="button">
                      <Trash2 size={16} />
                      Delete
                    </button>
                  ) : null}
                  <button className="button" disabled={!canEdit || isSaving} onClick={saveCompany} type="button">
                    <Save size={16} />
                    {isSaving ? "Saving..." : "Save company"}
                  </button>
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function InputField({
  disabled,
  label,
  value,
  onChange
}: {
  disabled?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  disabled,
  label,
  value,
  onChange
}: {
  disabled?: boolean;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        disabled={disabled}
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

function handleScrollLoadMore(
  event: UIEvent<HTMLElement>,
  visibleCount: number,
  totalCount: number,
  setVisibleCount: Dispatch<SetStateAction<number>>,
  batchSize: number
) {
  if (visibleCount >= totalCount) {
    return;
  }

  const element = event.currentTarget;
  const remainingScroll = element.scrollHeight - element.scrollTop - element.clientHeight;

  if (remainingScroll > 180) {
    return;
  }

  setVisibleCount((current) => Math.min(totalCount, current + batchSize));
}

function LoadMoreStatus({ shown, total }: { shown: number; total: number }) {
  return (
    <div className="load-more-status">
      {shown >= total ? `Showing all ${total}` : `Showing ${shown} of ${total}. Scroll for more.`}
    </div>
  );
}

function companyPayload(company: ManagementCompany) {
  return {
    slug: company.slug || slugify(company.name),
    name: company.name,
    website: company.website,
    key_assets: company.key_assets,
    unit_count_label: company.unit_count_label,
    estimated_unit_count: company.estimated_unit_count,
    notes: company.notes,
    contact_email: company.contact_email,
    contact_phone: company.contact_phone
  };
}
