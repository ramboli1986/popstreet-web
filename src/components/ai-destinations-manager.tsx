"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction, type UIEvent } from "react";
import { BriefcaseBusiness, Plus, RefreshCw, Save, School, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { canEditInventory, canManageAccounts, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type {
  AccountProfile,
  AISearchDestinationKind,
  AISearchDestinationOption,
  AISearchDestinationOptionKind,
  AISearchDestinationQuery
} from "@/lib/types";

type AIDestinationsManagerProps = {
  profile: AccountProfile | null;
};

type DestinationKindFilter = AISearchDestinationKind | "all";
type OptionDraft = AISearchDestinationOption;

const destinationKinds: AISearchDestinationKind[] = ["work", "school"];
const optionKinds: AISearchDestinationOptionKind[] = ["office", "campus", "school", "company", "other"];
const queryBatchSize = 50;

export function AIDestinationsManager({ profile }: AIDestinationsManagerProps) {
  const { language, t } = useI18n();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [queries, setQueries] = useState<AISearchDestinationQuery[]>([]);
  const [draft, setDraft] = useState<AISearchDestinationQuery | null>(null);
  const [search, setSearch] = useState("");
  const [destinationKindFilter, setDestinationKindFilter] = useState<DestinationKindFilter>("all");
  const [visibleCount, setVisibleCount] = useState(queryBatchSize);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = canEditInventory(profile?.role, profile?.account_kind, profile?.status);
  const canDelete = canManageAccounts(profile?.role, profile?.account_kind, profile?.status);

  const loadQueries = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("ai_search_destination_queries")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(2000);

    setIsLoading(false);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setQueries(((data ?? []) as AISearchDestinationQuery[]).map(normalizedQueryRow));
  }, []);

  useEffect(() => {
    loadQueries();
  }, [loadQueries]);

  useEffect(() => {
    setVisibleCount(queryBatchSize);
  }, [destinationKindFilter, search]);

  const filteredQueries = useMemo(() => {
    const query = search.trim().toLowerCase();

    return queries.filter((row) => {
      const matchesKind = destinationKindFilter === "all" || row.destination_kind === destinationKindFilter;
      const options = normalizedOptions(row.result.options);
      const matchesSearch =
        !query ||
        [
          row.raw_query,
          row.query_normalized,
          row.destination_kind,
          row.model,
          row.result.message,
          ...options.flatMap((option) => [option.name, option.address, option.subtitle, option.kind])
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));

      return matchesKind && matchesSearch;
    });
  }, [destinationKindFilter, queries, search]);

  const visibleQueries = useMemo(() => filteredQueries.slice(0, visibleCount), [filteredQueries, visibleCount]);

  function createQueryDraft() {
    const now = new Date().toISOString();

    setDraft({
      query_normalized: "",
      destination_kind: "work",
      raw_query: "",
      result: {
        query: "",
        options: [],
        message: "I found a few possible locations. Pick the one you mean."
      },
      model: "manual-admin",
      hit_count: 0,
      last_used_at: now,
      created_at: now,
      updated_at: now
    });
    setMessage(null);
    setError(null);
  }

  function updateDraft(patch: Partial<AISearchDestinationQuery>) {
    setDraft((current) => (current ? normalizedQueryRow({ ...current, ...patch }) : current));
  }

  function updateResult(patch: Partial<AISearchDestinationQuery["result"]>) {
    setDraft((current) =>
      current
        ? normalizedQueryRow({
            ...current,
            result: {
              ...current.result,
              ...patch
            }
          })
        : current
    );
  }

  function updateOption(index: number, patch: Partial<OptionDraft>) {
    setDraft((current) => {
      if (!current) return current;
      const options = normalizedOptions(current.result.options).map((option, optionIndex) =>
        optionIndex === index ? normalizedOption({ ...option, ...patch }, optionIndex) : option
      );
      return normalizedQueryRow({ ...current, result: { ...current.result, options } });
    });
  }

  function addOption() {
    setDraft((current) => {
      if (!current) return current;
      const options = [
        ...normalizedOptions(current.result.options),
        {
          id: `office-${Date.now()}`,
          name: "",
          address: "",
          subtitle: "",
          kind: current.destination_kind === "school" ? "campus" : "office",
          confidence: 0.8
        } satisfies OptionDraft
      ];
      return normalizedQueryRow({ ...current, result: { ...current.result, options } });
    });
  }

  function deleteOption(index: number) {
    setDraft((current) => {
      if (!current) return current;
      const options = normalizedOptions(current.result.options).filter((_option, optionIndex) => optionIndex !== index);
      return normalizedQueryRow({ ...current, result: { ...current.result, options } });
    });
  }

  async function saveQuery() {
    if (!draft || !canEdit) {
      return;
    }

    const rawQuery = draft.raw_query.trim();
    const queryNormalized = normalizeDestinationQuery(rawQuery || draft.query_normalized);
    const options = normalizedOptions(draft.result.options).filter((option) => option.name.trim() && option.address.trim());

    if (!queryNormalized || !rawQuery) {
      setError(t("aiDestinations.queryRequired"));
      return;
    }

    if (options.length === 0) {
      setError(t("aiDestinations.optionRequired"));
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const payload = {
      query_normalized: queryNormalized,
      destination_kind: draft.destination_kind,
      raw_query: rawQuery,
      result: {
        query: rawQuery,
        options,
        message:
          draft.result.message.trim() ||
          (options.length === 1
            ? `Using ${options[0].name}.`
            : "I found a few possible locations. Pick the one you mean.")
      },
      model: draft.model?.trim() || "manual-admin",
      last_used_at: draft.last_used_at || new Date().toISOString()
    };

    const { data, error: saveError } = await supabase
      .from("ai_search_destination_queries")
      .upsert(payload, { onConflict: "query_normalized,destination_kind" })
      .select("*")
      .single();

    setIsSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    const saved = normalizedQueryRow(data as AISearchDestinationQuery);
    setQueries((current) => {
      const withoutSaved = current.filter(
        (row) =>
          !(row.query_normalized === saved.query_normalized && row.destination_kind === saved.destination_kind)
      );
      return [saved, ...withoutSaved].sort((first, second) => second.updated_at.localeCompare(first.updated_at));
    });
    setDraft(saved);
    setMessage(t("aiDestinations.saved"));
  }

  async function deleteQuery(row: AISearchDestinationQuery) {
    if (!canDelete) {
      return;
    }

    const confirmed = window.confirm(t("aiDestinations.deleteConfirm", { name: row.raw_query || row.query_normalized }));
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("ai_search_destination_queries")
      .delete()
      .eq("query_normalized", row.query_normalized)
      .eq("destination_kind", row.destination_kind);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setQueries((current) =>
      current.filter((item) => !(item.query_normalized === row.query_normalized && item.destination_kind === row.destination_kind))
    );
    setDraft(null);
    setMessage(t("aiDestinations.deleted"));
  }

  return (
    <>
      <div className="page-hero manager-hero">
        <div>
          <div className="eyebrow">{t("aiDestinations.eyebrow")}</div>
          <h1>{t("aiDestinations.title", { count: queries.length.toLocaleString(locale) })}</h1>
          <p>{t("aiDestinations.subtitle")}</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={loadQueries} disabled={isLoading} type="button">
            <RefreshCw size={16} />
            {t("common.refresh")}
          </button>
          <button className="button" disabled={!canEdit} onClick={createQueryDraft} type="button">
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
              {kind === "work" ? t("aiDestinations.work") : t("aiDestinations.school")}
            </option>
          ))}
        </select>
        <div className="toolbar-stat">
          <strong>{filteredQueries.length.toLocaleString(locale)}</strong>
          <span>{t("aiDestinations.queries")}</span>
        </div>
        <div className="toolbar-stat">
          <strong>{queries.reduce((sum, row) => sum + normalizedOptions(row.result.options).length, 0).toLocaleString(locale)}</strong>
          <span>{t("aiDestinations.offices")}</span>
        </div>
      </section>

      <section className="data-panel building-list-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">{t("aiDestinations.list")}</div>
            <h3>{t("aiDestinations.cacheRecords")}</h3>
          </div>
          <span className="count-pill">
            {isLoading ? t("common.loading") : `${filteredQueries.length.toLocaleString(locale)} ${t("common.total")}`}
          </span>
        </div>

        {visibleQueries.length === 0 ? (
          <div className="empty-state">{t("aiDestinations.empty")}</div>
        ) : (
          <div
            className="admin-table-wrap"
            onScroll={(event) =>
              handleScrollLoadMore(event, visibleCount, filteredQueries.length, setVisibleCount, queryBatchSize)
            }
          >
            <table className="admin-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>{t("aiDestinations.query")}</th>
                  <th>{t("aiDestinations.kind")}</th>
                  <th>{t("aiDestinations.offices")}</th>
                  <th>{t("aiDestinations.hits")}</th>
                  <th>{t("aiDestinations.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleQueries.map((row, index) => {
                  const options = normalizedOptions(row.result.options);

                  return (
                    <tr
                      className="clickable-row"
                      key={`${row.query_normalized}-${row.destination_kind}`}
                      onClick={() => setDraft(row)}
                      tabIndex={0}
                    >
                      <td className="row-index">{index + 1}</td>
                      <td>
                        <button
                          className="table-primary-link"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDraft(row);
                          }}
                          type="button"
                        >
                          {row.raw_query || row.query_normalized}
                        </button>
                        <div className="table-subtext">{row.query_normalized}</div>
                      </td>
                      <td>
                        <span className="count-pill">
                          {row.destination_kind === "work" ? <BriefcaseBusiness size={12} /> : <School size={12} />}
                          {row.destination_kind === "work" ? t("aiDestinations.work") : t("aiDestinations.school")}
                        </span>
                      </td>
                      <td>
                        <OptionSummary options={options} />
                      </td>
                      <td>{row.hit_count.toLocaleString(locale)}</td>
                      <td>
                        {formatDate(row.updated_at)}
                        <div className="table-subtext">{row.model ?? t("common.na")}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <LoadMoreStatus shown={visibleQueries.length} total={filteredQueries.length} />
          </div>
        )}
      </section>

      {draft ? (
        <QueryDrawer
          canDelete={canDelete}
          canEdit={canEdit}
          draft={draft}
          isSaving={isSaving}
          onAddOption={addOption}
          onClose={() => setDraft(null)}
          onDeleteOption={deleteOption}
          onDeleteQuery={deleteQuery}
          onSave={saveQuery}
          onUpdateDraft={updateDraft}
          onUpdateOption={updateOption}
          onUpdateResult={updateResult}
          t={t}
        />
      ) : null}
    </>
  );
}

function QueryDrawer({
  canDelete,
  canEdit,
  draft,
  isSaving,
  onAddOption,
  onClose,
  onDeleteOption,
  onDeleteQuery,
  onSave,
  onUpdateDraft,
  onUpdateOption,
  onUpdateResult,
  t
}: {
  canDelete: boolean;
  canEdit: boolean;
  draft: AISearchDestinationQuery;
  isSaving: boolean;
  onAddOption: () => void;
  onClose: () => void;
  onDeleteOption: (index: number) => void;
  onDeleteQuery: (query: AISearchDestinationQuery) => void;
  onSave: () => void;
  onUpdateDraft: (patch: Partial<AISearchDestinationQuery>) => void;
  onUpdateOption: (index: number, patch: Partial<OptionDraft>) => void;
  onUpdateResult: (patch: Partial<AISearchDestinationQuery["result"]>) => void;
  t: (key: string, params?: Record<string, number | string>) => string;
}) {
  const options = normalizedOptions(draft.result.options);

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="side-drawer building-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <div className="eyebrow">{t("aiDestinations.drawerEyebrow")}</div>
            <h3>{draft.raw_query || t("aiDestinations.newDestination")}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="editor-form">
            <div className="form-section-title">{t("aiDestinations.queryProfile")}</div>
            <div className="form-grid dense">
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.rawQuery")}
                value={draft.raw_query}
                onChange={(value) => onUpdateDraft({ raw_query: value, query_normalized: normalizeDestinationQuery(value) })}
              />
              <InputField disabled label={t("aiDestinations.queryNormalized")} value={draft.query_normalized} onChange={() => undefined} />
              <SelectField
                disabled={!canEdit}
                label={t("aiDestinations.kind")}
                value={draft.destination_kind}
                onChange={(value) => onUpdateDraft({ destination_kind: value as AISearchDestinationKind })}
              >
                <option value="work">{t("aiDestinations.work")}</option>
                <option value="school">{t("aiDestinations.school")}</option>
              </SelectField>
              <InputField
                disabled={!canEdit}
                label={t("aiDestinations.model")}
                value={draft.model ?? ""}
                onChange={(value) => onUpdateDraft({ model: value || null })}
              />
              <label className="field full">
                <span>{t("aiDestinations.message")}</span>
                <textarea
                  disabled={!canEdit}
                  value={draft.result.message}
                  onChange={(event) => onUpdateResult({ message: event.target.value })}
                />
              </label>
            </div>

            <div className="destination-options-header">
              <div>
                <div className="form-section-title">{t("aiDestinations.optionManager")}</div>
                <p className="table-subtext">{t("aiDestinations.optionHint")}</p>
              </div>
              <button className="ghost-button" disabled={!canEdit} onClick={onAddOption} type="button">
                <Plus size={16} />
                {t("aiDestinations.addOffice")}
              </button>
            </div>

            <div className="destination-option-list">
              {options.length === 0 ? (
                <div className="empty-state compact-empty-state">{t("aiDestinations.noOptions")}</div>
              ) : (
                options.map((option, index) => (
                  <div className="destination-option-card" key={`${option.id}-${index}`}>
                    <div className="destination-option-card-head">
                      <strong>{option.name || t("aiDestinations.unnamedOffice")}</strong>
                      <button className="icon-button danger" disabled={!canDelete && !canEdit} onClick={() => onDeleteOption(index)} type="button">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="form-grid dense">
                      <InputField
                        disabled={!canEdit}
                        label={t("aiDestinations.displayName")}
                        value={option.name}
                        onChange={(value) => onUpdateOption(index, { name: value })}
                      />
                      <SelectField
                        disabled={!canEdit}
                        label={t("aiDestinations.optionKind")}
                        value={option.kind}
                        onChange={(value) => onUpdateOption(index, { kind: value as AISearchDestinationOptionKind })}
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
                        value={option.address}
                        onChange={(value) => onUpdateOption(index, { address: value })}
                      />
                      <InputField
                        disabled={!canEdit}
                        label={t("aiDestinations.subtitleField")}
                        value={option.subtitle}
                        onChange={(value) => onUpdateOption(index, { subtitle: value })}
                      />
                      <NumberField
                        disabled={!canEdit}
                        label={t("aiDestinations.confidence")}
                        max={1}
                        min={0}
                        step={0.01}
                        value={option.confidence}
                        onChange={(value) => onUpdateOption(index, { confidence: value })}
                      />
                      <InputField
                        disabled={!canEdit}
                        label="ID"
                        value={option.id}
                        onChange={(value) => onUpdateOption(index, { id: value })}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <footer className="drawer-footer">
          <button className="danger-button" disabled={!canDelete} onClick={() => onDeleteQuery(draft)} type="button">
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

function OptionSummary({ options }: { options: AISearchDestinationOption[] }) {
  if (options.length === 0) {
    return <span className="table-subtext">N/A</span>;
  }

  return (
    <div className="option-summary">
      <span className="count-pill">{options.length} offices</span>
      <span className="table-subtext">{options.map((option) => option.name || option.address).join(" · ")}</span>
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

function normalizedQueryRow(row: AISearchDestinationQuery): AISearchDestinationQuery {
  const result = row.result && typeof row.result === "object"
    ? row.result
    : { query: row.raw_query, options: [], message: "" };

  return {
    ...row,
    raw_query: row.raw_query || result.query || row.query_normalized,
    result: {
      query: result.query || row.raw_query || row.query_normalized,
      options: normalizedOptions(result.options),
      message: result.message || ""
    }
  };
}

function normalizedOptions(options: unknown): AISearchDestinationOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.map((option, index) => normalizedOption(option, index));
}

function normalizedOption(option: unknown, index: number): AISearchDestinationOption {
  const value = (option && typeof option === "object" ? option : {}) as Partial<AISearchDestinationOption>;
  const name = typeof value.name === "string" ? value.name : "";
  const address = typeof value.address === "string" ? value.address : "";

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : destinationOptionID(name, address, index),
    name,
    address,
    subtitle: typeof value.subtitle === "string" ? value.subtitle : "",
    kind: optionKinds.includes(value.kind as AISearchDestinationOptionKind)
      ? (value.kind as AISearchDestinationOptionKind)
      : "office",
    confidence: clampConfidence(typeof value.confidence === "number" ? value.confidence : 0.8)
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

function destinationOptionID(name: string, address: string, index: number) {
  const slug = `${name}-${address}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || `office-${index + 1}`;
}

function kindLabel(kind: AISearchDestinationOptionKind) {
  return kind.replaceAll("_", " ");
}
