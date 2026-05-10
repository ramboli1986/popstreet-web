"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Building2,
  Check,
  Edit3,
  EyeOff,
  LocateFixed,
  MapPinned,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  UploadCloud
} from "lucide-react";
import { BuildingMap } from "./building-map";
import { supabase } from "@/lib/supabase";
import {
  canEditInventory,
  formatDate,
  formatMoneyFromCents,
  slugify,
  stringArrayToInput,
  toStringArray
} from "@/lib/format";
import type { AccountProfile, Building, ListingStatus, Neighborhood, Unit, UnitListing, UnitWithListing } from "@/lib/types";

type BuildingManagerProps = {
  profile: AccountProfile | null;
  mode: "inventory" | "map";
};

type InventoryTab = "profile" | "units" | "map";
type StatusFilter = "all" | "active" | "archived";
type UnitIndex = Pick<Unit, "id" | "building_id">;
type BuildingMetric = {
  unitCount: number;
  availableCount: number;
  minNetPrice: number | null;
  latestListingAt: string | null;
};

const listingStatuses: ListingStatus[] = ["available", "pending", "unavailable", "rented", "archived"];

export function BuildingManager({ profile, mode }: BuildingManagerProps) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [unitIndex, setUnitIndex] = useState<UnitIndex[]>([]);
  const [listingIndex, setListingIndex] = useState<UnitListing[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [draft, setDraft] = useState<Building | null>(null);
  const [units, setUnits] = useState<UnitWithListing[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<InventoryTab>(mode === "map" ? "map" : "profile");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = canEditInventory(profile?.role);

  const loadBuildings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [buildingResult, neighborhoodResult, unitResult, listingResult] = await Promise.all([
      supabase
        .from("buildings")
        .select("*, neighborhoods(name, slug)")
        .order("updated_at", { ascending: false })
        .limit(800),
      supabase.from("neighborhoods").select("id, slug, name, city, state").order("name"),
      supabase.from("units").select("id, building_id").limit(5000),
      supabase.from("unit_listings").select("*").order("updated_at", { ascending: false }).limit(5000)
    ]);

    setIsLoading(false);

    if (buildingResult.error || neighborhoodResult.error || unitResult.error || listingResult.error) {
      setError(
        buildingResult.error?.message ??
          neighborhoodResult.error?.message ??
          unitResult.error?.message ??
          listingResult.error?.message ??
          "Could not load inventory."
      );
      return;
    }

    const nextBuildings = (buildingResult.data ?? []) as Building[];
    const nextSelected =
      selectedBuilding == null
        ? nextBuildings[0] ?? null
        : nextBuildings.find((building) => building.id === selectedBuilding.id) ?? nextBuildings[0] ?? null;

    setBuildings(nextBuildings);
    setNeighborhoods((neighborhoodResult.data ?? []) as Neighborhood[]);
    setUnitIndex((unitResult.data ?? []) as UnitIndex[]);
    setListingIndex((listingResult.data ?? []) as UnitListing[]);
    setSelectedBuilding(nextSelected);
    setDraft(nextSelected ? { ...nextSelected } : null);
  }, [selectedBuilding]);

  const loadUnits = useCallback(async (building: Building | null) => {
    if (!building || building.id.startsWith("new-")) {
      setUnits([]);
      return;
    }

    const { data: unitRows, error: unitError } = await supabase
      .from("units")
      .select("*")
      .eq("building_id", building.id)
      .order("unit_number");

    if (unitError) {
      setError(unitError.message);
      return;
    }

    const baseUnits = (unitRows ?? []) as UnitWithListing[];
    const unitIDs = baseUnits.map((unit) => unit.id);

    if (unitIDs.length === 0) {
      setUnits([]);
      return;
    }

    const { data: listingRows, error: listingError } = await supabase
      .from("unit_listings")
      .select("*")
      .in("unit_id", unitIDs)
      .order("updated_at", { ascending: false });

    if (listingError) {
      setError(listingError.message);
      return;
    }

    const listingsByUnit = new Map<string, UnitListing>();
    ((listingRows ?? []) as UnitListing[]).forEach((listing) => {
      if (!listingsByUnit.has(listing.unit_id)) {
        listingsByUnit.set(listing.unit_id, listing);
      }
    });

    setUnits(baseUnits.map((unit) => ({ ...unit, listing: listingsByUnit.get(unit.id) ?? null })));
  }, []);

  useEffect(() => {
    loadBuildings();
  }, []);

  useEffect(() => {
    loadUnits(selectedBuilding);
  }, [loadUnits, selectedBuilding]);

  useEffect(() => {
    if (mode === "map") {
      setActiveTab("map");
    }
  }, [mode]);

  const buildingMetrics = useMemo(() => {
    const latestListingByUnit = new Map<string, UnitListing>();

    listingIndex.forEach((listing) => {
      if (!latestListingByUnit.has(listing.unit_id)) {
        latestListingByUnit.set(listing.unit_id, listing);
      }
    });

    const nextMetrics = new Map<string, BuildingMetric>();

    unitIndex.forEach((unit) => {
      const metric = nextMetrics.get(unit.building_id) ?? {
        unitCount: 0,
        availableCount: 0,
        minNetPrice: null,
        latestListingAt: null
      };
      const listing = latestListingByUnit.get(unit.id);

      metric.unitCount += 1;

      if (listing) {
        metric.latestListingAt =
          metric.latestListingAt == null || listing.updated_at > metric.latestListingAt
            ? listing.updated_at
            : metric.latestListingAt;
      }

      if (listing?.status === "available") {
        metric.availableCount += 1;
        metric.minNetPrice =
          metric.minNetPrice == null ? listing.net_price_cents : Math.min(metric.minNetPrice, listing.net_price_cents);
      }

      nextMetrics.set(unit.building_id, metric);
    });

    return nextMetrics;
  }, [listingIndex, unitIndex]);

  const areaOptions = useMemo(() => {
    const labels = new Set<string>();

    buildings.forEach((building) => {
      const label = building.area || building.neighborhoods?.name || building.city;
      if (label) {
        labels.add(label);
      }
    });

    return Array.from(labels).sort((first, second) => first.localeCompare(second));
  }, [buildings]);

  const filteredBuildings = useMemo(() => {
    const query = search.trim().toLowerCase();

    return buildings.filter((building) => {
      const areaLabel = building.area || building.neighborhoods?.name || building.city;
      const matchesStatus =
        statusFilter === "all" || (statusFilter === "active" ? building.is_active : !building.is_active);
      const matchesArea = areaFilter === "all" || areaLabel === areaFilter;
      const matchesSearch =
        query.length === 0 ||
        [building.name, building.address, building.full_address, areaLabel, building.city, building.state]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));

      return matchesStatus && matchesArea && matchesSearch;
    });
  }, [areaFilter, buildings, search, statusFilter]);

  const filteredAvailableUnitCount = useMemo(
    () =>
      filteredBuildings.reduce((total, building) => total + (buildingMetrics.get(building.id)?.availableCount ?? 0), 0),
    [buildingMetrics, filteredBuildings]
  );

  function selectBuilding(building: Building) {
    setSelectedBuilding(building);
    setDraft({ ...building });
    setMessage(null);
    setError(null);
  }

  function updateDraft<K extends keyof Building>(key: K, value: Building[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  const updateDraftCoordinate = useCallback(
    ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      if (!draft) {
        return;
      }

      updateDraft("latitude", latitude);
      updateDraft("longitude", longitude);
      setBuildings((current) =>
        current.map((building) => (building.id === draft.id ? { ...building, latitude, longitude } : building))
      );
      setSelectedBuilding((current) => (current ? { ...current, latitude, longitude } : current));
    },
    [draft]
  );

  function createBuildingDraft() {
    const now = new Date().toISOString();
    const nextDraft: Building = {
      id: `new-${Date.now()}`,
      slug: "new-building",
      name: "New Building",
      address: "",
      full_address: "",
      neighborhood_id: null,
      city: "New York",
      state: "NY",
      postal_code: null,
      latitude: 40.742,
      longitude: -74,
      score: null,
      summary: "",
      description_labels: [],
      cover_image_url: null,
      story_video_url: null,
      is_active: true,
      year_built: null,
      total_floors: null,
      total_units: null,
      management_company: null,
      website: null,
      area: "",
      created_at: now,
      updated_at: now,
      neighborhoods: null
    };

    setActiveTab("profile");
    setSelectedBuilding(nextDraft);
    setDraft(nextDraft);
    setUnits([]);
  }

  async function saveBuilding() {
    if (!draft || !canEdit) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const payload = buildingPayload(draft);
    const isNew = draft.id.startsWith("new-");
    const result = isNew
      ? await supabase.from("buildings").insert(payload).select("*, neighborhoods(name, slug)").single()
      : await supabase.from("buildings").update(payload).eq("id", draft.id).select("*, neighborhoods(name, slug)").single();

    setIsSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    const savedBuilding = result.data as Building;
    setMessage(isNew ? "Building created." : "Building saved.");
    setBuildings((current) => {
      const withoutDraft = current.filter((building) => building.id !== draft.id && building.id !== savedBuilding.id);
      return [savedBuilding, ...withoutDraft];
    });
    setSelectedBuilding(savedBuilding);
    setDraft({ ...savedBuilding });
  }

  async function setBuildingActive(building: Building, nextIsActive: boolean) {
    if (!canEdit || building.id.startsWith("new-")) {
      return;
    }

    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase.from("buildings").update({ is_active: nextIsActive }).eq("id", building.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    const applyPatch = (current: Building) => (current.id === building.id ? { ...current, is_active: nextIsActive } : current);
    setBuildings((current) => current.map(applyPatch));
    setSelectedBuilding((current) => (current ? applyPatch(current) : current));
    setDraft((current) => (current ? applyPatch(current) : current));
    setMessage(nextIsActive ? "Building activated." : "Building archived.");
  }

  async function deleteBuilding(building: Building) {
    if (!canEdit || building.id.startsWith("new-")) {
      return;
    }

    const confirmed = window.confirm(`Delete ${building.name}? This also removes its units, listings, images, and services.`);

    if (!confirmed) {
      return;
    }

    setError(null);
    setMessage(null);

    const { error: deleteError } = await supabase.from("buildings").delete().eq("id", building.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    const remaining = buildings.filter((item) => item.id !== building.id);
    const nextSelected = selectedBuilding?.id === building.id ? remaining[0] ?? null : selectedBuilding;

    setBuildings(remaining);
    setSelectedBuilding(nextSelected);
    setDraft(nextSelected ? { ...nextSelected } : null);
    setMessage("Building deleted.");
  }

  async function refreshAll() {
    await loadBuildings();
    await loadUnits(selectedBuilding);
  }

  return (
    <>
      <div className="content-header console-header">
        <div>
          <div className="eyebrow">{mode === "map" ? "Map editor" : "Inventory command"}</div>
          <h2>{mode === "map" ? "Building locations" : "Buildings and available units"}</h2>
          <p className="header-subtitle">
            Search, edit, publish, unlist, and keep app-facing inventory in sync from one screen.
          </p>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" disabled={isLoading} onClick={refreshAll} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
          {canEdit ? (
            <button className="button" onClick={createBuildingDraft} type="button">
              <Plus size={16} />
              New building
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="message error compact-message">{error}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}
      {!canEdit ? <div className="message compact-message">Viewer role is read-only.</div> : null}

      <section className="ops-toolbar">
        <label className="search-box">
          <Search size={16} />
          <input
            placeholder="Search name, address, area..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="all">All status</option>
          <option value="active">Active only</option>
          <option value="archived">Archived only</option>
        </select>
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
          <option value="all">All locations</option>
          {areaOptions.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
        <div className="toolbar-stat">
          <strong>{filteredBuildings.length}</strong>
          <span>buildings</span>
        </div>
        <div className="toolbar-stat">
          <strong>{filteredAvailableUnitCount}</strong>
          <span>available units</span>
        </div>
      </section>

      <div className={`operations-grid ${mode === "map" ? "map-mode" : ""}`}>
        <section className="data-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Building list</div>
              <h3>Fast query and edit</h3>
            </div>
            <span className="count-pill">{buildings.length} total</span>
          </div>
          <BuildingTable
            buildings={filteredBuildings}
            canEdit={canEdit}
            metrics={buildingMetrics}
            selectedBuilding={selectedBuilding}
            onArchive={(building) => setBuildingActive(building, false)}
            onDelete={deleteBuilding}
            onManageUnits={(building) => {
              selectBuilding(building);
              setActiveTab("units");
            }}
            onRestore={(building) => setBuildingActive(building, true)}
            onSelect={selectBuilding}
            onShowMap={(building) => {
              selectBuilding(building);
              setActiveTab("map");
            }}
          />
        </section>

        <aside className="inspector-panel">
          <div className="inspector-summary">
            <div>
              <div className="eyebrow">Selected building</div>
              <h3>{draft?.name ?? "No building selected"}</h3>
              <p className="muted">
                {draft
                  ? `${draft.area || draft.neighborhoods?.name || draft.city}, ${draft.state}`
                  : "Choose a row to edit building and units."}
              </p>
            </div>
            {draft ? (
              <div className="inspector-quick-actions">
                <span className={`status-pill ${draft.is_active ? "active" : "suspended"}`}>
                  {draft.is_active ? "Active" : "Archived"}
                </span>
                {!draft.id.startsWith("new-") ? (
                  <button
                    className="button compact-button"
                    disabled={!canEdit}
                    onClick={() => setActiveTab("units")}
                    type="button"
                  >
                    <Plus size={14} />
                    Add unit
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="inspector-tabs" role="tablist" aria-label="Inventory sections">
            <button
              className={activeTab === "profile" ? "active" : ""}
              onClick={() => setActiveTab("profile")}
              type="button"
            >
              <Edit3 size={15} />
              Profile
            </button>
            <button className={activeTab === "units" ? "active" : ""} onClick={() => setActiveTab("units")} type="button">
              <Building2 size={15} />
              Units
            </button>
            <button className={activeTab === "map" ? "active" : ""} onClick={() => setActiveTab("map")} type="button">
              <MapPinned size={15} />
              Map
            </button>
          </div>

          {activeTab === "profile" && draft ? (
            <BuildingEditor
              canEdit={canEdit}
              draft={draft}
              isSaving={isSaving}
              neighborhoods={neighborhoods}
              onArchive={() => setBuildingActive(draft, false)}
              onRestore={() => setBuildingActive(draft, true)}
              onSave={saveBuilding}
              updateDraft={updateDraft}
            />
          ) : null}

          {activeTab === "units" && draft ? (
            draft.id.startsWith("new-") ? (
              <EmptyState title="Save building first" body="Units can be added after the building has a database ID." />
            ) : (
              <UnitManager
                building={draft}
                canEdit={canEdit}
                onRefresh={async () => {
                  await loadUnits(draft);
                  await loadBuildings();
                }}
                units={units}
              />
            )
          ) : null}

          {activeTab === "map" ? (
            <section className="map-editor-panel">
              <div className="panel-heading compact">
                <div>
                  <div className="eyebrow">Coordinates</div>
                  <h3>{draft ? "Drag selected pin to update" : "Building map"}</h3>
                </div>
                <span className="count-pill">{filteredBuildings.length} pins</span>
              </div>
              <BuildingMap
                buildings={filteredBuildings}
                canEdit={canEdit}
                selectedBuilding={draft}
                onCoordinateChange={updateDraftCoordinate}
                onSelect={selectBuilding}
              />
              {draft ? (
                <div className="geo-row">
                  <NumberField
                    disabled={!canEdit}
                    label="Latitude"
                    step="0.000001"
                    value={draft.latitude}
                    onChange={(value) => updateDraft("latitude", value ?? 0)}
                  />
                  <NumberField
                    disabled={!canEdit}
                    label="Longitude"
                    step="0.000001"
                    value={draft.longitude}
                    onChange={(value) => updateDraft("longitude", value ?? 0)}
                  />
                  <button className="button" disabled={!canEdit || isSaving} onClick={saveBuilding} type="button">
                    <LocateFixed size={16} />
                    Save location
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function BuildingTable({
  buildings,
  canEdit,
  metrics,
  selectedBuilding,
  onArchive,
  onDelete,
  onManageUnits,
  onRestore,
  onSelect,
  onShowMap
}: {
  buildings: Building[];
  canEdit: boolean;
  metrics: Map<string, BuildingMetric>;
  selectedBuilding: Building | null;
  onArchive: (building: Building) => void;
  onDelete: (building: Building) => void;
  onManageUnits: (building: Building) => void;
  onRestore: (building: Building) => void;
  onSelect: (building: Building) => void;
  onShowMap: (building: Building) => void;
}) {
  if (buildings.length === 0) {
    return <EmptyState title="No buildings found" body="Try clearing the search or location filters." />;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Building</th>
            <th>Location</th>
            <th>Available</th>
            <th>Lowest net</th>
            <th>Updated</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {buildings.map((building) => {
            const metric = metrics.get(building.id);
            const isSelected = selectedBuilding?.id === building.id;

            return (
              <tr className={isSelected ? "selected" : ""} key={building.id}>
                <td>
                  <button className="table-primary-link" onClick={() => onSelect(building)} type="button">
                    {building.name}
                  </button>
                  <div className="table-subtext">{building.address}</div>
                </td>
                <td>
                  <strong>{building.area || building.neighborhoods?.name || building.city}</strong>
                  <div className="table-subtext">
                    {building.city}, {building.state}
                  </div>
                </td>
                <td>
                  <strong>{metric?.availableCount ?? 0}</strong>
                  <div className="table-subtext">{metric?.unitCount ?? 0} units</div>
                </td>
                <td>{formatMoneyFromCents(metric?.minNetPrice)}</td>
                <td>{formatDate(metric?.latestListingAt ?? building.updated_at)}</td>
                <td>
                  <span className={`status-pill ${building.is_active ? "active" : "suspended"}`}>
                    {building.is_active ? "Active" : "Archived"}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="mini-action" onClick={() => onManageUnits(building)} type="button">
                      <Plus size={14} />
                      Units
                    </button>
                    <button className="icon-button" onClick={() => onShowMap(building)} title="Show on map" type="button">
                      <MapPinned size={15} />
                    </button>
                    {building.is_active ? (
                      <button
                        className="icon-button"
                        disabled={!canEdit}
                        onClick={() => onArchive(building)}
                        title="Archive"
                        type="button"
                      >
                        <Archive size={15} />
                      </button>
                    ) : (
                      <button
                        className="icon-button"
                        disabled={!canEdit}
                        onClick={() => onRestore(building)}
                        title="Activate"
                        type="button"
                      >
                        <Check size={15} />
                      </button>
                    )}
                    <button
                      className="icon-button danger"
                      disabled={!canEdit}
                      onClick={() => onDelete(building)}
                      title="Delete"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BuildingEditor({
  canEdit,
  draft,
  isSaving,
  neighborhoods,
  updateDraft,
  onArchive,
  onRestore,
  onSave
}: {
  canEdit: boolean;
  draft: Building;
  isSaving: boolean;
  neighborhoods: Neighborhood[];
  updateDraft: <K extends keyof Building>(key: K, value: Building[K]) => void;
  onArchive: () => void;
  onRestore: () => void;
  onSave: () => void;
}) {
  return (
    <section className="editor-form">
      <div className="form-section-title">Core profile</div>
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
          label="Address"
          value={draft.address}
          onChange={(value) => updateDraft("address", value)}
        />
        <InputField
          disabled={!canEdit}
          label="Full address"
          value={draft.full_address}
          onChange={(value) => updateDraft("full_address", value)}
        />
        <InputField disabled={!canEdit} label="Area" value={draft.area ?? ""} onChange={(value) => updateDraft("area", value)} />
        <label className="field">
          <span>Neighborhood</span>
          <select
            disabled={!canEdit}
            value={draft.neighborhood_id ?? ""}
            onChange={(event) => updateDraft("neighborhood_id", event.target.value || null)}
          >
            <option value="">None</option>
            {neighborhoods.map((neighborhood) => (
              <option key={neighborhood.id} value={neighborhood.id}>
                {neighborhood.name}, {neighborhood.state}
              </option>
            ))}
          </select>
        </label>
        <InputField disabled={!canEdit} label="City" value={draft.city} onChange={(value) => updateDraft("city", value)} />
        <InputField disabled={!canEdit} label="State" value={draft.state} onChange={(value) => updateDraft("state", value)} />
        <InputField
          disabled={!canEdit}
          label="Postal code"
          value={draft.postal_code ?? ""}
          onChange={(value) => updateDraft("postal_code", value || null)}
        />
        <NumberField
          disabled={!canEdit}
          label="Score"
          step="0.1"
          value={draft.score}
          onChange={(value) => updateDraft("score", value)}
        />
      </div>

      <div className="form-section-title">Building details</div>
      <div className="form-grid dense">
        <NumberField
          disabled={!canEdit}
          label="Year built"
          value={draft.year_built}
          onChange={(value) => updateDraft("year_built", value == null ? null : Math.round(value))}
        />
        <NumberField
          disabled={!canEdit}
          label="Floors"
          value={draft.total_floors}
          onChange={(value) => updateDraft("total_floors", value == null ? null : Math.round(value))}
        />
        <NumberField
          disabled={!canEdit}
          label="Total units"
          value={draft.total_units}
          onChange={(value) => updateDraft("total_units", value == null ? null : Math.round(value))}
        />
        <InputField
          disabled={!canEdit}
          label="Management"
          value={draft.management_company ?? ""}
          onChange={(value) => updateDraft("management_company", value || null)}
        />
        <InputField
          disabled={!canEdit}
          label="Website"
          value={draft.website ?? ""}
          onChange={(value) => updateDraft("website", value || null)}
        />
        <InputField
          disabled={!canEdit}
          label="Description labels"
          value={stringArrayToInput(draft.description_labels)}
          onChange={(value) => updateDraft("description_labels", toStringArray(value))}
        />
        <InputField
          disabled={!canEdit}
          label="Cover image URL"
          value={draft.cover_image_url ?? ""}
          onChange={(value) => updateDraft("cover_image_url", value || null)}
        />
        <InputField
          disabled={!canEdit}
          label="Story video URL"
          value={draft.story_video_url ?? ""}
          onChange={(value) => updateDraft("story_video_url", value || null)}
        />
        <label className="field full">
          <span>AI summary</span>
          <textarea
            disabled={!canEdit}
            value={draft.summary ?? ""}
            onChange={(event) => updateDraft("summary", event.target.value)}
          />
        </label>
      </div>

      <div className="form-row sticky-actions">
        {!draft.id.startsWith("new-") ? (
          draft.is_active ? (
            <button className="ghost-button" disabled={!canEdit} onClick={onArchive} type="button">
              <Archive size={16} />
              Archive
            </button>
          ) : (
            <button className="ghost-button" disabled={!canEdit} onClick={onRestore} type="button">
              <Check size={16} />
              Activate
            </button>
          )
        ) : null}
        <button className="button" disabled={!canEdit || isSaving} onClick={onSave} type="button">
          <Save size={16} />
          {isSaving ? "Saving..." : "Save building"}
        </button>
      </div>
    </section>
  );
}

function UnitManager({
  building,
  units,
  canEdit,
  onRefresh
}: {
  building: Building;
  units: UnitWithListing[];
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addUnit() {
    if (!canEdit) {
      return;
    }

    setIsAdding(true);
    setError(null);

    const unitNumber = `New-${Date.now().toString().slice(-4)}`;
    const { error: unitError } = await supabase.from("units").insert({
      building_id: building.id,
      unit_number: unitNumber,
      name: `${unitNumber} - 1 Bed`,
      bedroom_count: 1,
      bathroom_count: 1,
      sqft: null,
      floor: null,
      description_labels: ["Admin created"]
    });

    setIsAdding(false);

    if (unitError) {
      setError(unitError.message);
      return;
    }

    onRefresh();
  }

  return (
    <section className="units-panel">
      <div className="panel-heading compact">
        <div>
          <div className="eyebrow">Available unit lists</div>
          <h3>{building.name}</h3>
        </div>
        <button className="button compact-button" disabled={!canEdit || isAdding} onClick={addUnit} type="button">
          <Plus size={15} />
          Add unit
        </button>
      </div>

      {error ? <div className="message error compact-message">{error}</div> : null}

      {units.length === 0 ? (
        <EmptyState title="No units yet" body="Add a unit, then publish its listing when pricing is ready." />
      ) : (
        <div className="unit-table-wrap">
          <div className="unit-table">
            <div className="unit-table-head">
              <span>Unit</span>
              <span>Layout</span>
              <span>Price</span>
              <span>Deal</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {units.map((unit) => (
              <UnitListingRow canEdit={canEdit} key={unit.id} onSaved={onRefresh} unit={unit} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function UnitListingRow({ unit, canEdit, onSaved }: { unit: UnitWithListing; canEdit: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState(unit);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(unit);
    setError(null);
  }, [unit]);

  function updateListing<K extends keyof UnitListing>(key: K, value: UnitListing[K]) {
    setDraft((current) => ({
      ...current,
      listing: {
        ...defaultListing(current.id),
        ...current.listing,
        [key]: value
      }
    }));
  }

  async function persistUnit(nextDraft: UnitWithListing) {
    if (!canEdit) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const { error: unitError } = await supabase
      .from("units")
      .update({
        unit_number: nextDraft.unit_number,
        name: nextDraft.name,
        description: nextDraft.description,
        bedroom_count: nextDraft.bedroom_count,
        bathroom_count: nextDraft.bathroom_count,
        sqft: nextDraft.sqft,
        floor: nextDraft.floor,
        description_labels: nextDraft.description_labels
      })
      .eq("id", nextDraft.id);

    if (unitError) {
      setError(unitError.message);
      setIsSaving(false);
      return;
    }

    const listing = nextDraft.listing ? { ...defaultListing(nextDraft.id), ...nextDraft.listing } : null;

    if (listing) {
      const listingPayload = {
        unit_id: nextDraft.id,
        status: listing.status,
        market_price_cents: listing.market_price_cents,
        net_price_cents: listing.net_price_cents,
        lease_deal: listing.lease_deal,
        free_months: listing.free_months,
        cash_back_cents: listing.cash_back_cents,
        available_from: listing.available_from,
        source: listing.source || "admin",
        last_seen_at: new Date().toISOString(),
        unavailable_at: listing.status === "available" ? null : listing.unavailable_at
      };

      const listingResult = listing.id
        ? await supabase.from("unit_listings").update(listingPayload).eq("id", listing.id)
        : await supabase.from("unit_listings").insert(listingPayload);

      if (listingResult.error) {
        setError(listingResult.error.message);
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    onSaved();
  }

  async function publishUnit() {
    const now = new Date().toISOString();
    const listing = {
      ...defaultListing(draft.id),
      ...draft.listing,
      status: "available" as ListingStatus,
      listed_at: draft.listing?.listed_at ?? now,
      last_seen_at: now,
      unavailable_at: null,
      source: draft.listing?.source ?? "admin"
    };
    const nextDraft = { ...draft, listing };

    setDraft(nextDraft);
    await persistUnit(nextDraft);
  }

  async function unlistUnit() {
    const listing = {
      ...defaultListing(draft.id),
      ...draft.listing,
      status: "unavailable" as ListingStatus,
      unavailable_at: new Date().toISOString(),
      source: draft.listing?.source ?? "admin"
    };
    const nextDraft = { ...draft, listing };

    setDraft(nextDraft);
    await persistUnit(nextDraft);
  }

  async function deleteUnit() {
    if (!canEdit) {
      return;
    }

    const confirmed = window.confirm(`Delete unit ${draft.unit_number}? This also removes its listing history.`);

    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const { error: deleteError } = await supabase.from("units").delete().eq("id", draft.id);

    setIsSaving(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    onSaved();
  }

  const listing = draft.listing ?? defaultListing(draft.id);

  return (
    <div className="unit-table-row">
      <div className="unit-cell unit-identity">
        <input
          disabled={!canEdit}
          value={draft.unit_number}
          onChange={(event) => setDraft((current) => ({ ...current, unit_number: event.target.value }))}
        />
        <input
          disabled={!canEdit}
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </div>
      <div className="unit-cell unit-layout">
        <NumberInput
          disabled={!canEdit}
          label="Bed"
          value={draft.bedroom_count}
          onChange={(value) => setDraft((current) => ({ ...current, bedroom_count: value ?? 0 }))}
        />
        <NumberInput
          disabled={!canEdit}
          label="Bath"
          step="0.5"
          value={draft.bathroom_count}
          onChange={(value) => setDraft((current) => ({ ...current, bathroom_count: value ?? 0 }))}
        />
        <NumberInput
          disabled={!canEdit}
          label="Sqft"
          value={draft.sqft}
          onChange={(value) => setDraft((current) => ({ ...current, sqft: value == null ? null : Math.round(value) }))}
        />
      </div>
      <div className="unit-cell unit-price">
        <CentsInput disabled={!canEdit} label="Market" value={listing.market_price_cents} onChange={(value) => updateListing("market_price_cents", value)} />
        <CentsInput
          disabled={!canEdit}
          label="Net"
          value={listing.net_price_cents}
          onChange={(value) => updateListing("net_price_cents", value ?? 0)}
        />
        <CentsInput
          disabled={!canEdit}
          label="Cashback"
          value={listing.cash_back_cents}
          onChange={(value) => updateListing("cash_back_cents", value ?? 0)}
        />
      </div>
      <div className="unit-cell unit-deal">
        <input
          disabled={!canEdit}
          placeholder="Lease deal"
          value={listing.lease_deal ?? ""}
          onChange={(event) => updateListing("lease_deal", event.target.value || null)}
        />
        <input
          disabled={!canEdit}
          type="date"
          value={listing.available_from ?? ""}
          onChange={(event) => updateListing("available_from", event.target.value || null)}
        />
      </div>
      <div className="unit-cell">
        <select
          disabled={!canEdit}
          value={listing.status}
          onChange={(event) => updateListing("status", event.target.value as ListingStatus)}
        >
          {listingStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <span className={`status-pill ${listing.status === "available" ? "active" : "suspended"}`}>
          {listing.status}
        </span>
      </div>
      <div className="unit-cell unit-actions">
        <button className="button compact-button" disabled={!canEdit || isSaving} onClick={() => persistUnit(draft)} type="button">
          <Save size={14} />
          Save
        </button>
        <button className="ghost-button compact-button" disabled={!canEdit || isSaving} onClick={publishUnit} type="button">
          <UploadCloud size={14} />
          Publish
        </button>
        <button className="ghost-button compact-button" disabled={!canEdit || isSaving} onClick={unlistUnit} type="button">
          <EyeOff size={14} />
          Unlist
        </button>
        <button className="danger-button compact-button" disabled={!canEdit || isSaving} onClick={deleteUnit} type="button">
          <Trash2 size={14} />
          Delete
        </button>
        {error ? <span className="row-error">{error}</span> : null}
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  disabled,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input disabled={disabled} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  step = "1"
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        disabled={disabled}
        step={step}
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  disabled,
  step = "1"
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <input
        disabled={disabled}
        step={step}
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

function CentsInput({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <input
        disabled={disabled}
        type="number"
        value={value == null ? "" : value / 100}
        onChange={(event) => onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * 100))}
      />
    </label>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function defaultListing(unitID: string): UnitListing {
  const now = new Date().toISOString();

  return {
    id: "",
    unit_id: unitID,
    status: "available",
    market_price_cents: null,
    net_price_cents: 0,
    lease_deal: null,
    free_months: 0,
    cash_back_cents: 0,
    available_from: null,
    listed_at: now,
    last_seen_at: now,
    unavailable_at: null,
    source: "admin",
    source_listing_id: null,
    created_at: now,
    updated_at: now
  };
}

function buildingPayload(building: Building) {
  return {
    slug: building.slug || slugify(building.name),
    name: building.name,
    address: building.address,
    full_address: building.full_address || building.address,
    neighborhood_id: building.neighborhood_id,
    city: building.city,
    state: building.state,
    postal_code: building.postal_code,
    latitude: building.latitude,
    longitude: building.longitude,
    score: building.score,
    summary: building.summary,
    description_labels: building.description_labels,
    cover_image_url: building.cover_image_url,
    story_video_url: building.story_video_url,
    is_active: building.is_active,
    year_built: building.year_built,
    total_floors: building.total_floors,
    total_units: building.total_units,
    management_company: building.management_company,
    website: building.website,
    area: building.area
  };
}
