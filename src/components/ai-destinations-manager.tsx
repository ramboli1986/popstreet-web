"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction, type UIEvent } from "react";
import { BriefcaseBusiness, Plus, RefreshCw, Save, School, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { canEditInventory, canManageAccounts, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type {
  AccountProfile,
  AISearchDestination,
  AISearchDestinationAlias,
  AISearchDestinationKind,
  AISearchDestinationOptionKind
} from "@/lib/types";

type AIDestinationsManagerProps = {
  profile: AccountProfile | null;
};

const optionKinds: AISearchDestinationOptionKind[] = ["office", "campus", "school", "company", "other"];
const destinationKinds: AISearchDestinationKind[] = ["work", "school"];
const destinationBatchSize = 50;

type StatusFilter = "all" | "active" | "inactive";
type KindFilter = AISearchDestinationOptionKind | "all";
type DestinationKindFilter = AISearchDestinationKind | "all";

type AliasDraft = {
  raw_query: string;
  destination_kind: AISearchDestinationKind;
  match_confidence: number;
};

const defaultAliasDraft: AliasDraft = {
  raw_query: "",
  destination_kind: "work",
  match_confidence: 0.8
};

export function AIDestinationsManager({ profile }: AIDestinationsManagerProps) {
  const { language, t } = useI18n();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [destinations, setDestinations] = useState<AISearchDestination[]>([]);
  const [aliases, setAliases] = useState<AISearchDestinationAlias[]>([]);
  const [draft, setDraft] = useState<AISearchDestination | null>(null);
  const [aliasDraft, setAliasDraft] = useState<AliasDraft>(defaultAliasDraft);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [destinationKindFilter, setDestinationKindFilter] = useState<DestinationKindFilter>("all");
  const [visibleCount, setVisibleCount] = useState(destinationBatchSize);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAlias, setIsSavingAlias] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = canEditInventory(profile?.role, profile?.account_kind, profile?.status);
  const canDelete = canManageAccounts(profile?.role, profile?.account_kind, profile?.status);

  const aliasesByDestination = useMemo(() => {
    const grouped = new Map<string, AISearchDestinationAlias[]>();

    aliases.forEach((alias) => {
      const current = grouped.get(alias.destination_id) ?? [];
      current.push(alias);
      grouped.set(alias.destination_id, current);
    });

    grouped.forEach((items, destinationID) => {
      grouped.set(
        destinationID,
        items.sort((first, second) => {
          if (first.destination_kind !== second.destination_kind) {
            return first.destination_kind.localeCompare(second.destination_kind);
          }
          return second.hit_count - first.hit_count;
        })
      );
    });

    return grouped;
  }, [aliases]);

  const loadDestinations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [destinationResult, aliasResult] = await Promise.all([
      supabase.from("ai_search_destinations").select("*").order("updated_at", { ascending: false }).limit(2000),
      supabase.from("ai_search_destination_aliases").select("*").order("updated_at", { ascending: false }).limit(5000)
    ]);

    setIsLoading(false);

    if (destinationResult.error) {
      setError(destinationResult.error.message);
      return;
    }

    if (aliasResult.error) {
      setError(aliasResult.error.message);
      return;
    }

    setDestinations((destinationResult.data ?? []) as AISearchDestination[]);
    setAliases((aliasResult.data ?? []) as AISearchDestinationAlias[]);
  }, []);

  useEffect(() => {
    loadDestinations();
  }, [loadDestinations]);

  useEffect(() => {
    setVisibleCount(destinationBatchSize);
  }, [destinationKindFilter, kindFilter, search, statusFilter]);

  const filteredDestinations = useMemo(() => {
    const query = search.trim().toLowerCase();

    return destinations.filter((destination) => {
      const destinationAliases = aliasesByDestination.get(destination.id) ?? [];
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && destination.is_active) ||
        (statusFilter === "inactive" && !destination.is_active);
      const matchesKind = kindFilter === "all" || destination.option_kind === kindFilter;
      const matchesDestinationKind =
        destinationKindFilter === "all" ||
        destinationAliases.some((alias) => alias.destination_kind === destinationKindFilter);
      const matchesQuery =
        !query ||
        [
          destination.display_name,
          destination.address,
          destination.subtitle,
          destination.option_kind,
          destination.model,
          ...destinationAliases.flatMap((alias) => [alias.raw_query, alias.query_normalized, alias.destination_kind])
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));

      return matchesStatus && matchesKind && matchesDestinationKind && matchesQuery;
    });
  }, [aliasesByDestination, destinationKindFilter, destinations, kindFilter, search, statusFilter]);

  const visibleDestinations = useMemo(
    () => filteredDestinations.slice(0, visibleCount),
    [filteredDestinations, visibleCount]
  );

  function createDestinationDraft() {
    const now = new Date().toISOString();

    setDraft({
      id: `new-${Date.now()}`,
      display_name: "",
      display_name_normalized: "",
      address: "",
      address_normalized: "",
      subtitle: "",
      option_kind: "office",
      model: null,
      confidence: 0.7,
      is_active: true,
      last_verified_at: now,
      created_at: now,
      updated_at: now
    });
    setAliasDraft(defaultAliasDraft);
    setMessage(null);
    setError(null);
  }

  function updateDraft<K extends keyof AISearchDestination>(key: K, value: AISearchDestination[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveDestination() {
    if (!draft || !canEdit) {
      return;
    }

    const payload = destinationPayload(draft);
    if (!payload.display_name || !payload.address) {
      setError(t("aiDestinations.required"));
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const isNew = draft.id.startsWith("new-");
    const result = isNew
      ? await supabase.from("ai_search_destinations").insert(payload).select("*").single()
      : await supabase.from("ai_search_destinations").update(payload).eq("id", draft.id).select("*").single();

    setIsSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    const saved = result.data as AISearchDestination;
    setDestinations((current) => {
      const withoutSaved = current.filter((destination) => destination.id !== draft.id && destination.id !== saved.id);
      return [saved, ...withoutSaved].sort((first, second) => second.updated_at.localeCompare(first.updated_at));
    });
    setDraft(saved);
    setMessage(isNew ? t("aiDestinations.created") : t("aiDestinations.saved"));
  }

  async function deleteDestination(destination: AISearchDestination) {
    if (!canDelete || destination.id.startsWith("new-")) {
      return;
    }

    const confirmed = window.confirm(t("aiDestinations.deleteConfirm", { name: destination.display_name }));
    if (!confirmed) {
      return;
    }

    setError(null);
    setMessage(null);

    const { error: deleteError } = await supabase.from("ai_search_destinations").delete().eq("id", destination.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setDestinations((current) => current.filter((item) => item.id !== destination.id));
    setAliases((current) => current.filter((alias) => alias.destination_id !== destination.id));
    setDraft(null);
    setMessage(t("aiDestinations.deleted"));
  }

  async function saveAlias() {
    if (!draft || !canEdit || draft.id.startsWith("new-")) {
      setError(t("aiDestinations.saveDestinationFirst"));
      return;
    }

    const rawQuery = aliasDraft.raw_query.trim();
    const queryNormalized = normalizeDestinationQuery(rawQuery);
    if (!queryNormalized) {
      setError(t("aiDestinations.aliasRequired"));
      return;
    }

    setIsSavingAlias(true);
    setError(null);
    setMessage(null);

    const payload = {
      query_normalized: queryNormalized,
      destination_kind: aliasDraft.destination_kind,
      destination_id: draft.id,
      raw_query: rawQuery,
      match_confidence: clampConfidence(aliasDraft.match_confidence),
      last_used_at: new Date().toISOString()
    };

    const { data, error: saveError } = await supabase
      .from("ai_search_destination_aliases")
      .upsert(payload, { onConflict: "query_normalized,destination_kind,destination_id" })
      .select("*")
      .single();

    setIsSavingAlias(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    const saved = data as AISearchDestinationAlias;
    setAliases((current) => {
      const withoutSaved = current.filter(
        (alias) =>
          !(
            alias.query_normalized === saved.query_normalized &&
            alias.destination_kind === saved.destination_kind &&
            alias.destination_id === saved.destination_id
          )
      );
      return [saved, ...withoutSaved];
    });
    setAliasDraft(defaultAliasDraft);
    setMessage(t("aiDestinations.aliasSaved"));
  }

  async function deleteAlias(alias: AISearchDestinationAlias) {
    if (!canDelete) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("ai_search_destination_aliases")
      .delete()
      .eq("query_normalized", alias.query_normalized)
      .eq("destination_kind", alias.destination_kind)
      .eq("destination_id", alias.destination_id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setAliases((current) =>
      current.filter(
        (item) =>
          !(
            item.query_normalized === alias.query_normalized &&
            item.destination_kind === alias.destination_kind &&
            item.destination_id === alias.destination_id
          )
      )
    );
    setMessage(t("aiDestinations.aliasDeleted"));
  }

  return (
    <>
      <div className="page-hero manager-hero">
        <div>
          <div className="eyebrow">{t("aiDestinations.eyebrow")}</div>
          <h1>{t("aiDestinations.title", { count: destinations.length.toLocaleString(locale) })}</h1>
          <p>{t("aiDestinations.subtitle")}</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={loadDestinations} disabled={isLoading} type="button">
            <RefreshCw size={16} />
            {t("common.refresh")}
          </button>
          <button className="button" disabled={!canEdit} onClick={createDestinationDraft} type="button">
            <Plus size={16} />
            {t("aiDestinations.add")}
          </button>
        </div>
      </div>

      {!canEdit ? <div className="message compact-message">{t("aiDestinations.viewerOnly")}</div> : null}
      {error ? <div className="message error compact-message">{error}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}

      <section className="ops-toolbar ai-destinations-toolbar">
        <label className="search-box">
          <Search size={16} />
          <input
            placeholder={t("aiDestinations.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="all">{t("aiDestinations.allStatuses")}</option>
          <option value="active">{t("aiDestinations.activeOnly")}</option>
          <option value="inactive">{t("aiDestinations.inactiveOnly")}</option>
        </select>
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)}>
          <option value="all">{t("aiDestinations.allKinds")}</option>
          {optionKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(kind)}
            </option>
          ))}
        </select>
        <select
          value={destinationKindFilter}
          onChange={(event) => setDestinationKindFilter(event.target.value as DestinationKindFilter)}
        >
          <option value="all">{t("aiDestinations.allAliases")}</option>
          {destinationKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind === "work" ? t("aiDestinations.work") : t("aiDestinations.school")}
            </option>
          ))}
        </select>
        <div className="toolbar-stat">
          <strong>{destinations.filter((destination) => destination.is_active).length.toLocaleString(locale)}</strong>
          <span>{t("common.active")}</span>
        </div>
        <div className="toolbar-stat">
          <strong>{aliases.length.toLocaleString(locale)}</strong>
          <span>{t("aiDestinations.aliases")}</span>
        </div>
      </section>

      <section className="data-panel building-list-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">{t("aiDestinations.list")}</div>
            <h3>{t("aiDestinations.cacheRecords")}</h3>
          </div>
          <span className="count-pill">
            {isLoading ? t("common.loading") : `${filteredDestinations.length.toLocaleString(locale)} ${t("common.total")}`}
          </span>
        </div>

        {visibleDestinations.length === 0 ? (
          <div className="empty-state">{t("aiDestinations.empty")}</div>
        ) : (
          <div
            className="admin-table-wrap"
            onScroll={(event) =>
              handleScrollLoadMore(
                event,
                visibleCount,
                filteredDestinations.length,
                setVisibleCount,
                destinationBatchSize
              )
            }
          >
            <table className="admin-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>{t("aiDestinations.destination")}</th>
                  <th>{t("aiDestinations.address")}</th>
                  <th>{t("aiDestinations.kind")}</th>
                  <th>{t("aiDestinations.status")}</th>
                  <th>{t("aiDestinations.aliases")}</th>
                  <th>{t("aiDestinations.hits")}</th>
                  <th>{t("aiDestinations.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleDestinations.map((destination, index) => {
                  const destinationAliases = aliasesByDestination.get(destination.id) ?? [];
                  const hitCount = destinationAliases.reduce((sum, alias) => sum + alias.hit_count, 0);

                  return (
                    <tr className="clickable-row" key={destination.id} onClick={() => setDraft(destination)} tabIndex={0}>
                      <td className="row-index">{index + 1}</td>
                      <td>
                        <button
                          className="table-primary-link"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDraft(destination);
                          }}
                          type="button"
                        >
                          {destination.display_name}
                        </button>
                        <div className="table-subtext">{destination.subtitle || t("common.na")}</div>
                      </td>
                      <td>
                        <span>{destination.address}</span>
                        {destination.model ? <div className="table-subtext">{destination.model}</div> : null}
                      </td>
                      <td>{kindLabel(destination.option_kind)}</td>
                      <td>
                        <span className={`status-pill ${destination.is_active ? "active" : "suspended"}`}>
                          {destination.is_active ? t("common.active") : t("common.disabled")}
                        </span>
                      </td>
                      <td>
                        <AliasSummary aliases={destinationAliases} />
                      </td>
                      <td>{hitCount.toLocaleString(locale)}</td>
                      <td>{formatDate(destination.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <LoadMoreStatus shown={visibleDestinations.length} total={filteredDestinations.length} />
          </div>
        )}
      </section>

      {draft ? (
        <DestinationDrawer
          aliasDraft={aliasDraft}
          aliases={aliasesByDestination.get(draft.id) ?? []}
          canDelete={canDelete}
          canEdit={canEdit}
          destination={draft}
          isSaving={isSaving}
          isSavingAlias={isSavingAlias}
          onAliasDraftChange={setAliasDraft}
          onClose={() => setDraft(null)}
          onDeleteAlias={deleteAlias}
          onDeleteDestination={deleteDestination}
          onSaveAlias={saveAlias}
          onSaveDestination={saveDestination}
          onUpdateDestination={updateDraft}
          t={t}
        />
      ) : null}
    </>
  );
}

function DestinationDrawer({
  aliasDraft,
  aliases,
  canDelete,
  canEdit,
  destination,
  isSaving,
  isSavingAlias,
  onAliasDraftChange,
  onClose,
  onDeleteAlias,
  onDeleteDestination,
  onSaveAlias,
  onSaveDestination,
  onUpdateDestination,
  t
}: {
  aliasDraft: AliasDraft;
  aliases: AISearchDestinationAlias[];
  canDelete: boolean;
  canEdit: boolean;
  destination: AISearchDestination;
  isSaving: boolean;
  isSavingAlias: boolean;
  onAliasDraftChange: Dispatch<SetStateAction<AliasDraft>>;
  onClose: () => void;
  onDeleteAlias: (alias: AISearchDestinationAlias) => void;
  onDeleteDestination: (destination: AISearchDestination) => void;
  onSaveAlias: () => void;
  onSaveDestination: () => void;
  onUpdateDestination: <K extends keyof AISearchDestination>(key: K, value: AISearchDestination[K]) => void;
  t: (key: string, params?: Record<string, number | string>) => string;
}) {
  const isNew = destination.id.startsWith("new-");

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="side-drawer building-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <div className="eyebrow">{t("aiDestinations.drawerEyebrow")}</div>
            <h3>{isNew ? t("aiDestinations.newDestination") : destination.display_name}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="editor-form">
            <div className="form-section-title">{t("aiDestinations.destinationProfile")}</div>
            <div className="form-grid dense">
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.displayName")}
                value={destination.display_name}
                onChange={(value) => onUpdateDestination("display_name", value)}
              />
              <SelectField
                disabled={!canEdit}
                label={t("aiDestinations.kind")}
                value={destination.option_kind}
                onChange={(value) => onUpdateDestination("option_kind", value as AISearchDestinationOptionKind)}
              >
                {optionKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabel(kind)}
                  </option>
                ))}
              </SelectField>
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.address")}
                value={destination.address}
                onChange={(value) => onUpdateDestination("address", value)}
              />
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.subtitleField")}
                value={destination.subtitle}
                onChange={(value) => onUpdateDestination("subtitle", value)}
              />
              <NumberField
                disabled={!canEdit}
                label={t("aiDestinations.confidence")}
                max={1}
                min={0}
                step={0.01}
                value={destination.confidence}
                onChange={(value) => onUpdateDestination("confidence", value)}
              />
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.model")}
                value={destination.model ?? ""}
                onChange={(value) => onUpdateDestination("model", value || null)}
              />
              <SelectField
                disabled={!canEdit}
                label={t("aiDestinations.status")}
                value={destination.is_active ? "active" : "inactive"}
                onChange={(value) => onUpdateDestination("is_active", value === "active")}
              >
                <option value="active">{t("common.active")}</option>
                <option value="inactive">{t("common.disabled")}</option>
              </SelectField>
              <InputField disabled label={t("aiDestinations.lastVerified")} value={formatDate(destination.last_verified_at)} onChange={() => undefined} />
            </div>

            <div className="form-section-title">{t("aiDestinations.aliasManager")}</div>
            <p className="table-subtext" style={{ marginBottom: 10 }}>
              {t("aiDestinations.aliasHint")}
            </p>

            <div className="alias-editor-row">
              <InputField
                disabled={!canEdit || isNew}
                label={t("aiDestinations.rawQuery")}
                value={aliasDraft.raw_query}
                onChange={(value) => onAliasDraftChange((current) => ({ ...current, raw_query: value }))}
              />
              <SelectField
                disabled={!canEdit || isNew}
                label={t("aiDestinations.aliasKind")}
                value={aliasDraft.destination_kind}
                onChange={(value) =>
                  onAliasDraftChange((current) => ({ ...current, destination_kind: value as AISearchDestinationKind }))
                }
              >
                <option value="work">{t("aiDestinations.work")}</option>
                <option value="school">{t("aiDestinations.school")}</option>
              </SelectField>
              <NumberField
                disabled={!canEdit || isNew}
                label={t("aiDestinations.matchConfidence")}
                max={1}
                min={0}
                step={0.01}
                value={aliasDraft.match_confidence}
                onChange={(value) => onAliasDraftChange((current) => ({ ...current, match_confidence: value }))}
              />
              <button className="ghost-button" disabled={!canEdit || isNew || isSavingAlias} onClick={onSaveAlias} type="button">
                <Plus size={16} />
                {isSavingAlias ? t("common.saving") : t("aiDestinations.addAlias")}
              </button>
            </div>

            <div className="destination-alias-list">
              {aliases.length === 0 ? (
                <div className="empty-state compact-empty-state">{t("aiDestinations.noAliases")}</div>
              ) : (
                aliases.map((alias) => (
                  <div className="destination-alias-card" key={`${alias.query_normalized}-${alias.destination_kind}-${alias.destination_id}`}>
                    <div className="destination-alias-kind">
                      {alias.destination_kind === "work" ? <BriefcaseBusiness size={15} /> : <School size={15} />}
                      {alias.destination_kind === "work" ? t("aiDestinations.work") : t("aiDestinations.school")}
                    </div>
                    <div>
                      <strong>{alias.raw_query || alias.query_normalized}</strong>
                      <div className="table-subtext">{alias.query_normalized}</div>
                    </div>
                    <div className="destination-alias-metric">
                      <span>{t("aiDestinations.hits")}</span>
                      <strong>{alias.hit_count}</strong>
                    </div>
                    <div className="destination-alias-metric">
                      <span>{t("aiDestinations.confidence")}</span>
                      <strong>{Math.round(alias.match_confidence * 100)}%</strong>
                    </div>
                    <button className="icon-button danger" disabled={!canDelete} onClick={() => onDeleteAlias(alias)} title="Delete alias" type="button">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <footer className="drawer-footer">
          {!isNew ? (
            <button className="danger-button" disabled={!canDelete} onClick={() => onDeleteDestination(destination)} type="button">
              <Trash2 size={16} />
              {t("aiDestinations.deleteDestination")}
            </button>
          ) : null}
          <button className="button" disabled={!canEdit || isSaving} onClick={onSaveDestination} type="button">
            <Save size={16} />
            {isSaving ? t("common.saving") : t("aiDestinations.saveDestination")}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function AliasSummary({ aliases }: { aliases: AISearchDestinationAlias[] }) {
  if (aliases.length === 0) {
    return <span className="table-subtext">N/A</span>;
  }

  const firstAliases = aliases.slice(0, 2);

  return (
    <div className="alias-summary">
      {firstAliases.map((alias) => (
        <span className="count-pill" key={`${alias.query_normalized}-${alias.destination_kind}`}>
          {alias.destination_kind === "work" ? <BriefcaseBusiness size={12} /> : <School size={12} />}
          {alias.raw_query || alias.query_normalized}
        </span>
      ))}
      {aliases.length > firstAliases.length ? <span className="table-subtext">+{aliases.length - firstAliases.length}</span> : null}
    </div>
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
  max,
  min,
  step,
  value,
  onChange
}: {
  disabled?: boolean;
  label: string;
  max?: number;
  min?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
      />
    </label>
  );
}

function SelectField({
  children,
  disabled,
  label,
  value,
  onChange
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
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

function destinationPayload(destination: AISearchDestination) {
  return {
    display_name: destination.display_name.trim(),
    address: destination.address.trim(),
    subtitle: destination.subtitle.trim(),
    option_kind: destination.option_kind,
    model: destination.model?.trim() || null,
    confidence: clampConfidence(destination.confidence),
    is_active: destination.is_active,
    last_verified_at: destination.last_verified_at || new Date().toISOString()
  };
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeDestinationQuery(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
}

function kindLabel(kind: AISearchDestinationOptionKind) {
  return kind.replaceAll("_", " ");
}
