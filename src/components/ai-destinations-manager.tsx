"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BriefcaseBusiness, Plus, RefreshCw, Save, School, Search, TrainFront, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { canEditInventory, canManageAccounts, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { TRANSIT_LINE_OPTIONS, normalizeTransitLines, toggleTransitLine } from "@/lib/transit-lines";
import type {
  AccountProfile,
  AISearchDestinationKind,
  AISearchDestinationOptionKind,
  ResolvedCommuteDestination
} from "@/lib/types";

type AIDestinationsManagerProps = {
  profile: AccountProfile | null;
};

type DestinationKindFilter = AISearchDestinationKind | "all";
type TransitLineFilter = (typeof TRANSIT_LINE_OPTIONS)[number] | "all";
type DestinationDraft = ResolvedCommuteDestination & { _isNew?: boolean };

const destinationKinds: AISearchDestinationKind[] = ["work", "school"];
const optionKinds: AISearchDestinationOptionKind[] = ["office", "campus", "school", "company", "other"];

export function AIDestinationsManager({ profile }: AIDestinationsManagerProps) {
  const { language, t } = useI18n();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [destinations, setDestinations] = useState<ResolvedCommuteDestination[]>([]);
  const [draft, setDraft] = useState<DestinationDraft | null>(null);
  const [search, setSearch] = useState("");
  const [destinationKindFilter, setDestinationKindFilter] = useState<DestinationKindFilter>("all");
  const [transitLineFilter, setTransitLineFilter] = useState<TransitLineFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = canEditInventory(profile?.role, profile?.account_kind, profile?.status);
  const canDelete = canManageAccounts(profile?.role, profile?.account_kind, profile?.status);

  const loadDestinations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("resolved_commute_destinations")
      .select("*")
      .order("last_resolved_at", { ascending: false })
      .limit(2000);

    setIsLoading(false);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setDestinations(sortDestinations(((data ?? []) as ResolvedCommuteDestination[]).map(normalizeDestinationRow)));
  }, []);

  useEffect(() => {
    loadDestinations();
  }, [loadDestinations]);

  const filteredDestinations = useMemo(() => {
    const query = search.trim().toLowerCase();

    return destinations.filter((row) => {
      const matchesKind = destinationKindFilter === "all" || row.destination_kind === destinationKindFilter;
      const matchesLine = transitLineFilter === "all" || row.nearby_transit_lines.includes(transitLineFilter);
      const matchesSearch =
        !query ||
        [
          row.query,
          row.name,
          row.address,
          row.subtitle,
          row.place_id,
          row.option_kind,
          row.provider,
          row.destination_kind,
          ...row.nearby_transit_lines
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query));

      return matchesKind && matchesLine && matchesSearch;
    });
  }, [destinationKindFilter, destinations, search, transitLineFilter]);

  const distinctTransitLineCount = useMemo(
    () => new Set(destinations.flatMap((row) => row.nearby_transit_lines)).size,
    [destinations]
  );

  function createDestinationDraft() {
    const now = new Date().toISOString();

    setDraft({
      id: `new-${Date.now()}`,
      query: "",
      destination_kind: "work",
      place_id: `manual-${Date.now()}`,
      name: "",
      address: "",
      subtitle: "",
      option_kind: "office",
      latitude: null,
      longitude: null,
      nearby_transit_lines: [],
      confidence: 0.75,
      provider: "manual-admin",
      first_seen_at: now,
      last_resolved_at: now,
      _isNew: true
    });
    setMessage(null);
    setError(null);
  }

  function editDestination(row: ResolvedCommuteDestination) {
    setDraft({ ...normalizeDestinationRow(row), nearby_transit_lines: [...row.nearby_transit_lines] });
    setMessage(null);
    setError(null);
  }

  function updateDraft(patch: Partial<DestinationDraft>) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const nextDraft = normalizeDestinationRow({ ...current, ...patch });
      return { ...nextDraft, _isNew: current._isNew };
    });
  }

  async function saveDestination() {
    if (!draft || !canEdit) {
      return;
    }

    const payload = destinationPayload(draft);
    if (!payload.query || !payload.place_id || !payload.name || !payload.address) {
      setError(t("aiDestinations.required"));
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const request = draft._isNew
      ? supabase.from("resolved_commute_destinations").insert(payload).select("*").single()
      : supabase.from("resolved_commute_destinations").update(payload).eq("id", draft.id).select("*").single();

    const { data, error: saveError } = await request;
    setIsSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    const saved = normalizeDestinationRow(data as ResolvedCommuteDestination);
    setDestinations((current) => sortDestinations([saved, ...current.filter((row) => row.id !== saved.id)]));
    setDraft(saved);
    setMessage(t("aiDestinations.saved"));
  }

  async function deleteDestination(row: DestinationDraft) {
    if (!canDelete) {
      return;
    }

    if (row._isNew) {
      setDraft(null);
      return;
    }

    const confirmed = window.confirm(t("aiDestinations.deleteConfirm", { name: row.name || row.query }));
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase.from("resolved_commute_destinations").delete().eq("id", row.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setDestinations((current) => current.filter((item) => item.id !== row.id));
    setDraft(null);
    setMessage(t("aiDestinations.deleted"));
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
        <select
          value={destinationKindFilter}
          onChange={(event) => setDestinationKindFilter(event.target.value as DestinationKindFilter)}
        >
          <option value="all">{t("aiDestinations.allKinds")}</option>
          {destinationKinds.map((kind) => (
            <option key={kind} value={kind}>
              {destinationKindLabel(kind, t)}
            </option>
          ))}
        </select>
        <select value={transitLineFilter} onChange={(event) => setTransitLineFilter(event.target.value as TransitLineFilter)}>
          <option value="all">{t("aiDestinations.allLines")}</option>
          {TRANSIT_LINE_OPTIONS.map((line) => (
            <option key={line} value={line}>
              {line}
            </option>
          ))}
        </select>
        <div className="toolbar-stat">
          <strong>{filteredDestinations.length.toLocaleString(locale)}</strong>
          <span>{t("aiDestinations.destinations")}</span>
        </div>
        <div className="toolbar-stat">
          <strong>{distinctTransitLineCount.toLocaleString(locale)}</strong>
          <span>{t("aiDestinations.transitLines")}</span>
        </div>
      </section>

      <section className="data-panel building-list-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">{t("aiDestinations.list")}</div>
            <h3>{t("aiDestinations.tableTitle")}</h3>
          </div>
          <span className="count-pill">
            {isLoading ? t("common.loading") : `${filteredDestinations.length.toLocaleString(locale)} ${t("common.total")}`}
          </span>
        </div>

        {filteredDestinations.length === 0 ? (
          <div className="empty-state">{t("aiDestinations.empty")}</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>{t("aiDestinations.query")}</th>
                  <th>{t("aiDestinations.destination")}</th>
                  <th>{t("aiDestinations.kind")}</th>
                  <th>{t("aiDestinations.address")}</th>
                  <th>{t("aiDestinations.transit")}</th>
                  <th>{t("aiDestinations.confidence")}</th>
                  <th>{t("aiDestinations.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDestinations.map((row, index) => (
                  <tr className="clickable-row" key={row.id} onClick={() => editDestination(row)} tabIndex={0}>
                    <td className="row-index">{index + 1}</td>
                    <td>
                      <button
                        className="table-primary-link"
                        onClick={(event) => {
                          event.stopPropagation();
                          editDestination(row);
                        }}
                        type="button"
                      >
                        {row.query}
                      </button>
                      <div className="table-subtext">{row.place_id}</div>
                    </td>
                    <td>
                      <strong>{row.name}</strong>
                      <div className="table-subtext">{row.subtitle || formatProvider(row.provider)}</div>
                    </td>
                    <td>
                      <span className="count-pill">
                        {row.destination_kind === "work" ? <BriefcaseBusiness size={12} /> : <School size={12} />}
                        {destinationKindLabel(row.destination_kind, t)}
                      </span>
                    </td>
                    <td>
                      <div>{row.address}</div>
                      <div className="table-subtext">
                        {formatCoordinate(row.latitude)}, {formatCoordinate(row.longitude)}
                      </div>
                    </td>
                    <td>
                      <TransitLinePills lines={row.nearby_transit_lines} />
                    </td>
                    <td>{formatConfidence(row.confidence)}</td>
                    <td>
                      {formatDate(row.last_resolved_at)}
                      <div className="table-subtext">{formatProvider(row.provider)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {draft ? (
        <DestinationDrawer
          canDelete={canDelete}
          canEdit={canEdit}
          draft={draft}
          isSaving={isSaving}
          onClose={() => setDraft(null)}
          onDelete={deleteDestination}
          onSave={saveDestination}
          onUpdateDraft={updateDraft}
          t={t}
        />
      ) : null}
    </>
  );
}

function DestinationDrawer({
  canDelete,
  canEdit,
  draft,
  isSaving,
  onClose,
  onDelete,
  onSave,
  onUpdateDraft,
  t
}: {
  canDelete: boolean;
  canEdit: boolean;
  draft: DestinationDraft;
  isSaving: boolean;
  onClose: () => void;
  onDelete: (destination: DestinationDraft) => void;
  onSave: () => void;
  onUpdateDraft: (patch: Partial<DestinationDraft>) => void;
  t: (key: string, params?: Record<string, number | string>) => string;
}) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="side-drawer building-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <div className="eyebrow">{t("aiDestinations.drawerEyebrow")}</div>
            <h3>{draft.name || draft.query || t("aiDestinations.newDestination")}</h3>
            <div className="drawer-header-subtitle">
              {draft._isNew ? t("aiDestinations.newDestination") : `${t("aiDestinations.updated")} ${formatDate(draft.last_resolved_at)}`}
            </div>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="editor-form">
            <div className="form-section-title">{t("aiDestinations.queryProfile")}</div>
            <div className="form-grid dense">
              <InputField disabled={!canEdit} label={t("aiDestinations.query")} value={draft.query} onChange={(query) => onUpdateDraft({ query })} />
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.placeId")}
                value={draft.place_id}
                onChange={(place_id) => onUpdateDraft({ place_id })}
              />
              <SelectField
                disabled={!canEdit}
                label={t("aiDestinations.kind")}
                value={draft.destination_kind}
                onChange={(destination_kind) => onUpdateDraft({ destination_kind: destination_kind as AISearchDestinationKind })}
              >
                {destinationKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {destinationKindLabel(kind, t)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                disabled={!canEdit}
                label={t("aiDestinations.optionKind")}
                value={draft.option_kind}
                onChange={(option_kind) => onUpdateDraft({ option_kind: option_kind as AISearchDestinationOptionKind })}
              >
                {optionKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {optionKindLabel(kind)}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="form-section-title">{t("aiDestinations.destinationProfile")}</div>
            <div className="form-grid dense">
              <InputField disabled={!canEdit} label={t("aiDestinations.displayName")} value={draft.name} onChange={(name) => onUpdateDraft({ name })} />
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.provider")}
                value={draft.provider}
                onChange={(provider) => onUpdateDraft({ provider })}
              />
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.address")}
                value={draft.address}
                onChange={(address) => onUpdateDraft({ address })}
              />
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.subtitleField")}
                value={draft.subtitle}
                onChange={(subtitle) => onUpdateDraft({ subtitle })}
              />
              <NumberField
                disabled={!canEdit}
                label={t("aiDestinations.latitude")}
                step={0.000001}
                value={draft.latitude}
                onChange={(latitude) => onUpdateDraft({ latitude })}
              />
              <NumberField
                disabled={!canEdit}
                label={t("aiDestinations.longitude")}
                step={0.000001}
                value={draft.longitude}
                onChange={(longitude) => onUpdateDraft({ longitude })}
              />
              <NumberField
                disabled={!canEdit}
                label={t("aiDestinations.confidence")}
                max={1}
                min={0}
                step={0.01}
                value={draft.confidence}
                onChange={(confidence) => onUpdateDraft({ confidence: confidence ?? 0 })}
              />
            </div>

            <TransitLineSelector
              canEdit={canEdit}
              lines={draft.nearby_transit_lines}
              onChange={(nearby_transit_lines) => onUpdateDraft({ nearby_transit_lines })}
              t={t}
            />
          </section>
        </div>

        <footer className="drawer-footer">
          <button className="danger-button" disabled={!canDelete} onClick={() => onDelete(draft)} type="button">
            <Trash2 size={16} />
            {t("aiDestinations.deleteDestination")}
          </button>
          <button className="button" disabled={!canEdit || isSaving} onClick={onSave} type="button">
            <Save size={16} />
            {isSaving ? t("common.saving") : t("aiDestinations.saveDestination")}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function TransitLineSelector({
  canEdit,
  lines,
  onChange,
  t
}: {
  canEdit: boolean;
  lines: string[];
  onChange: (lines: string[]) => void;
  t: (key: string, params?: Record<string, number | string>) => string;
}) {
  const selectedLines = useMemo(() => new Set(normalizeTransitLines(lines)), [lines]);

  return (
    <section className="choice-editor">
      <div className="choice-editor-head">
        <div>
          <div className="form-section-title">{t("aiDestinations.transitLineManager")}</div>
          <p className="table-subtext">{t("aiDestinations.transitLineHint")}</p>
        </div>
        <span>{selectedLines.size} {t("common.selected")}</span>
      </div>
      <div className="choice-grid transit-choice-grid">
        {TRANSIT_LINE_OPTIONS.map((line) => (
          <label className="check-option" key={line}>
            <input
              checked={selectedLines.has(line)}
              disabled={!canEdit}
              type="checkbox"
              onChange={() => onChange(toggleTransitLine(lines, line))}
            />
            <span>{line}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function TransitLinePills({ lines }: { lines: string[] }) {
  const normalizedLines = normalizeTransitLines(lines);

  if (normalizedLines.length === 0) {
    return <span className="table-subtext">N/A</span>;
  }

  return (
    <div className="alias-summary">
      {normalizedLines.map((line) => (
        <span className="count-pill" key={line}>
          <TrainFront size={12} />
          {line}
        </span>
      ))}
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
  value: number | null;
  onChange: (value: number | null) => void;
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
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
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

function normalizeDestinationRow(row: ResolvedCommuteDestination): ResolvedCommuteDestination {
  return {
    ...row,
    query: row.query ?? "",
    place_id: row.place_id ?? "",
    name: row.name ?? "",
    address: row.address ?? "",
    subtitle: row.subtitle ?? "",
    option_kind: optionKinds.includes(row.option_kind) ? row.option_kind : "office",
    latitude: nullableNumber(row.latitude),
    longitude: nullableNumber(row.longitude),
    nearby_transit_lines: normalizeTransitLines(row.nearby_transit_lines ?? []),
    confidence: clampConfidence(Number(row.confidence ?? 0.75)),
    provider: row.provider ?? "google_maps",
    first_seen_at: row.first_seen_at ?? "",
    last_resolved_at: row.last_resolved_at ?? ""
  };
}

function destinationPayload(draft: DestinationDraft) {
  return {
    query: draft.query.trim(),
    destination_kind: draft.destination_kind,
    place_id: draft.place_id.trim(),
    name: draft.name.trim(),
    address: draft.address.trim(),
    subtitle: draft.subtitle.trim(),
    option_kind: draft.option_kind,
    latitude: nullableNumber(draft.latitude),
    longitude: nullableNumber(draft.longitude),
    nearby_transit_lines: normalizeTransitLines(draft.nearby_transit_lines),
    confidence: clampConfidence(draft.confidence),
    provider: draft.provider.trim() || "manual-admin",
    last_resolved_at: new Date().toISOString()
  };
}

function sortDestinations(destinations: ResolvedCommuteDestination[]) {
  return [...destinations].sort((first, second) => {
    const dateSort = second.last_resolved_at.localeCompare(first.last_resolved_at);
    return dateSort === 0 ? first.name.localeCompare(second.name) : dateSort;
  });
}

function nullableNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) {
    return null;
  }

  return Number(value);
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) {
    return 0.75;
  }

  return Math.min(1, Math.max(0, value));
}

function formatConfidence(value: number) {
  return `${Math.round(clampConfidence(value) * 100)}%`;
}

function formatCoordinate(value: number | null) {
  return value == null ? "N/A" : value.toFixed(5);
}

function formatProvider(provider: string) {
  if (provider === "google_maps") {
    return "Google Maps";
  }

  if (provider === "manual-admin") {
    return "Manual";
  }

  return provider.replaceAll("_", " ");
}

function destinationKindLabel(kind: AISearchDestinationKind, t: (key: string) => string) {
  return kind === "school" ? t("aiDestinations.school") : t("aiDestinations.work");
}

function optionKindLabel(kind: AISearchDestinationOptionKind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
