"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  EyeOff,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  UploadCloud,
  X
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
  mode: "building" | "units" | "map";
};

type StatusFilter = "all" | "active" | "archived";
type UnitIndex = Pick<Unit, "id" | "building_id">;
type BuildingMetric = {
  unitCount: number;
  availableCount: number;
  minNetPrice: number | null;
  latestListingAt: string | null;
};
type UnitStatusFilter = "all" | ListingStatus;
type UnitBedroomFilter = "all" | "0" | "1" | "2" | "3plus";

const listingStatuses: ListingStatus[] = ["available", "pending", "unavailable", "rented", "archived"];
const buildingPageSize = 25;
const unitPageSize = 25;

export function BuildingManager({ profile, mode }: BuildingManagerProps) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [unitIndex, setUnitIndex] = useState<UnitIndex[]>([]);
  const [listingIndex, setListingIndex] = useState<UnitListing[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [draft, setDraft] = useState<Building | null>(null);
  const [units, setUnits] = useState<UnitWithListing[]>([]);
  const [isBuildingEditorOpen, setIsBuildingEditorOpen] = useState(false);
  const [unitDialogDraft, setUnitDialogDraft] = useState<UnitWithListing | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [unitSearch, setUnitSearch] = useState("");
  const [unitBuildingFilter, setUnitBuildingFilter] = useState("all");
  const [unitStatusFilter, setUnitStatusFilter] = useState<UnitStatusFilter>("all");
  const [unitBedroomFilter, setUnitBedroomFilter] = useState<UnitBedroomFilter>("all");
  const [buildingPage, setBuildingPage] = useState(1);
  const [unitPage, setUnitPage] = useState(1);
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

  const loadUnits = useCallback(async () => {
    const { data: unitRows, error: unitError } = await supabase.from("units").select("*").order("unit_number").limit(5000);

    if (unitError) {
      setError(unitError.message);
      return;
    }

    const baseUnits = (unitRows ?? []) as UnitWithListing[];

    if (baseUnits.length === 0) {
      setUnits([]);
      return;
    }

    const { data: listingRows, error: listingError } = await supabase
      .from("unit_listings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(10000);

    if (listingError) {
      setError(listingError.message);
      setUnits(baseUnits.map((unit) => ({ ...unit, listing: null })));
      return;
    }

    const listingsByUnit = new Map<string, UnitListing>();
    const nextListings = (listingRows ?? []) as UnitListing[];

    nextListings.forEach((listing) => {
      if (!listingsByUnit.has(listing.unit_id)) {
        listingsByUnit.set(listing.unit_id, listing);
      }
    });

    setListingIndex(nextListings);
    setUnits(baseUnits.map((unit) => ({ ...unit, listing: listingsByUnit.get(unit.id) ?? null })));
  }, []);

  useEffect(() => {
    loadBuildings();
  }, []);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    setBuildingPage(1);
  }, [areaFilter, search, statusFilter]);

  useEffect(() => {
    setUnitPage(1);
  }, [unitBedroomFilter, unitBuildingFilter, unitSearch, unitStatusFilter]);

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

  const buildingByID = useMemo(() => {
    const nextBuildingsByID = new Map<string, Building>();

    buildings.forEach((building) => {
      nextBuildingsByID.set(building.id, building);
    });

    return nextBuildingsByID;
  }, [buildings]);

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
  const activeBuildingCount = useMemo(
    () => buildings.filter((building) => building.is_active).length,
    [buildings]
  );

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase();

    return units.filter((unit) => {
      const building = buildingByID.get(unit.building_id);
      const listing = unit.listing ?? defaultListing(unit.id);
      const matchesBuilding = unitBuildingFilter === "all" || unit.building_id === unitBuildingFilter;
      const matchesStatus = unitStatusFilter === "all" || listing.status === unitStatusFilter;
      const matchesBedroom =
        unitBedroomFilter === "all" ||
        (unitBedroomFilter === "3plus" ? unit.bedroom_count >= 3 : unit.bedroom_count === Number(unitBedroomFilter));
      const matchesSearch =
        query.length === 0 ||
        [
          unit.unit_number,
          unit.name,
          unit.description,
          building?.name,
          building?.address,
          building?.full_address,
          building?.area,
          building?.city,
          building?.state,
          listing.lease_deal
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));

      return matchesBuilding && matchesStatus && matchesBedroom && matchesSearch;
    });
  }, [buildingByID, unitBedroomFilter, unitBuildingFilter, units, unitSearch, unitStatusFilter]);

  const filteredUnitStats = useMemo(
    () => ({
      total: filteredUnits.length,
      available: filteredUnits.filter((unit) => (unit.listing ?? defaultListing(unit.id)).status === "available").length
    }),
    [filteredUnits]
  );

  const buildingPageMeta = useMemo(
    () => paginationMeta(filteredBuildings.length, buildingPage, buildingPageSize),
    [buildingPage, filteredBuildings.length]
  );

  const paginatedBuildings = useMemo(
    () => filteredBuildings.slice(buildingPageMeta.startIndex, buildingPageMeta.endIndex),
    [buildingPageMeta.endIndex, buildingPageMeta.startIndex, filteredBuildings]
  );

  const unitPageMeta = useMemo(
    () => paginationMeta(filteredUnits.length, unitPage, unitPageSize),
    [filteredUnits.length, unitPage]
  );

  const paginatedUnits = useMemo(
    () => filteredUnits.slice(unitPageMeta.startIndex, unitPageMeta.endIndex),
    [filteredUnits, unitPageMeta.endIndex, unitPageMeta.startIndex]
  );

  const selectedUnitFilterBuilding = useMemo(
    () => (unitBuildingFilter === "all" ? null : buildings.find((building) => building.id === unitBuildingFilter) ?? null),
    [buildings, unitBuildingFilter]
  );

  const unitDialogBuilding = useMemo(
    () => (unitDialogDraft ? buildingByID.get(unitDialogDraft.building_id) ?? selectedBuilding : null),
    [buildingByID, selectedBuilding, unitDialogDraft]
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

    setSelectedBuilding(nextDraft);
    setDraft(nextDraft);
    setIsBuildingEditorOpen(true);
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
    setIsBuildingEditorOpen(false);
  }

  function openBuildingEditor(building: Building) {
    selectBuilding(building);
    setIsBuildingEditorOpen(true);
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
    setIsBuildingEditorOpen(false);
    setMessage("Building deleted.");
  }

  async function refreshAll() {
    await loadBuildings();
    await loadUnits();
  }

  function openAddUnitDialog(building: Building | null = selectedBuilding) {
    if (!building || building.id.startsWith("new-")) {
      return;
    }

    selectBuilding(building);
    setUnitDialogDraft(createUnitDraft(building));
  }

  function openEditUnitDialog(unit: UnitWithListing) {
    const unitBuilding = buildings.find((building) => building.id === unit.building_id) ?? selectedBuilding;

    if (unitBuilding) {
      selectBuilding(unitBuilding);
    }

    setUnitDialogDraft(unit);
  }

  function openAddUnitFromUnitsPage() {
    const building =
      selectedUnitFilterBuilding ??
      (selectedBuilding && !selectedBuilding.id.startsWith("new-") ? selectedBuilding : null) ??
      buildings[0] ??
      null;

    openAddUnitDialog(building);
  }

  const pageCopy = {
    building: {
      eyebrow: "Buildings",
      title: `Inventory · ${buildings.length.toLocaleString()} properties`,
      subtitle: `${activeBuildingCount.toLocaleString()} active · ${(buildings.length - activeBuildingCount).toLocaleString()} archived · ${filteredAvailableUnitCount.toLocaleString()} available units`
    },
    units: {
      eyebrow: "Daily deals",
      title: "Units & Deals",
      subtitle: `${filteredUnitStats.total.toLocaleString()} matching units · ${filteredUnitStats.available.toLocaleString()} available right now`
    },
    map: {
      eyebrow: "Geo & coordinates",
      title: "Map editor",
      subtitle: "View buildings on one light map. Pin colors are grouped by area and selected pins can be edited."
    }
  }[mode];

  return (
    <>
      <div className="page-hero manager-hero">
        <div>
          <div className="eyebrow">{pageCopy.eyebrow}</div>
          <h1>{pageCopy.title}</h1>
          <p>{pageCopy.subtitle}</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" disabled={isLoading} onClick={refreshAll} type="button">
            <RefreshCcw size={16} />
            Refresh
          </button>
          {mode === "map" && draft ? (
            <button className="button dark-button" disabled={!canEdit || isSaving} onClick={saveBuilding} type="button">
              <Save size={16} />
              Save location
            </button>
          ) : null}
          {canEdit && mode === "building" ? (
            <button className="button dark-button" onClick={createBuildingDraft} type="button">
              <Plus size={16} />
              New building
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="message error compact-message">{error}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}
      {!canEdit ? <div className="message compact-message">Viewer role is read-only.</div> : null}

      {mode === "map" ? null : mode === "units" ? (
        <section className="ops-toolbar unit-ops-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="Search unit, building, address..."
              value={unitSearch}
              onChange={(event) => setUnitSearch(event.target.value)}
            />
          </label>
          <select value={unitBuildingFilter} onChange={(event) => setUnitBuildingFilter(event.target.value)}>
            <option value="all">All buildings</option>
            {buildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
          <select value={unitStatusFilter} onChange={(event) => setUnitStatusFilter(event.target.value as UnitStatusFilter)}>
            <option value="all">All status</option>
            {listingStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select value={unitBedroomFilter} onChange={(event) => setUnitBedroomFilter(event.target.value as UnitBedroomFilter)}>
            <option value="all">All layouts</option>
            <option value="0">Studio</option>
            <option value="1">1 bed</option>
            <option value="2">2 bed</option>
            <option value="3plus">3+ bed</option>
          </select>
          <div className="toolbar-stat">
            <strong>{filteredUnitStats.total}</strong>
            <span>units</span>
          </div>
          <div className="toolbar-stat">
            <strong>{filteredUnitStats.available}</strong>
            <span>available</span>
          </div>
          {canEdit ? (
            <button className="button" disabled={buildings.length === 0} onClick={openAddUnitFromUnitsPage} type="button">
              <Plus size={16} />
              Add unit
            </button>
          ) : null}
        </section>
      ) : (
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
      )}

      {mode === "map" ? (
        <section className="map-workspace-panel">
          <BuildingMap
            buildings={buildings}
            canEdit={canEdit}
            onCoordinateChange={updateDraftCoordinate}
            onSelect={selectBuilding}
            selectedBuilding={selectedBuilding}
          />
        </section>
      ) : mode === "units" ? (
        <UnitManager
          buildingsByID={buildingByID}
          canEdit={canEdit}
          filteredCount={filteredUnits.length}
          pageMeta={unitPageMeta}
          onPageChange={setUnitPage}
          onEditUnit={openEditUnitDialog}
          totalCount={units.length}
          units={paginatedUnits}
        />
      ) : (
        <div className={`inventory-stack ${mode === "building" ? "building-only" : ""}`}>
          <section className="data-panel building-list-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Building list</div>
                <h3>Fast query and edit</h3>
              </div>
              <span className="count-pill">{buildings.length} total</span>
            </div>
            <BuildingTable
              buildings={paginatedBuildings}
              canEdit={canEdit}
              metrics={buildingMetrics}
              selectedBuilding={selectedBuilding}
              startIndex={buildingPageMeta.startIndex}
              onArchive={(building) => setBuildingActive(building, false)}
              onDelete={deleteBuilding}
              onEdit={openBuildingEditor}
              onAddUnit={openAddUnitDialog}
              onOpen={openBuildingEditor}
              onRestore={(building) => setBuildingActive(building, true)}
            />
            <PaginationControls
              label="buildings"
              pageMeta={buildingPageMeta}
              onPageChange={setBuildingPage}
            />
          </section>

        </div>
      )}

      {isBuildingEditorOpen && draft ? (
        <BuildingEditorDialog
          canEdit={canEdit}
          draft={draft}
          isSaving={isSaving}
          neighborhoods={neighborhoods}
          onArchive={() => setBuildingActive(draft, false)}
          onClose={() => setIsBuildingEditorOpen(false)}
          onRestore={() => setBuildingActive(draft, true)}
          onSave={saveBuilding}
          updateDraft={updateDraft}
        />
      ) : null}

      {unitDialogDraft ? (
        <UnitEditorDialog
          building={unitDialogBuilding}
          canEdit={canEdit}
          onClose={() => setUnitDialogDraft(null)}
          onSaved={async () => {
            await loadUnits();
            await loadBuildings();
          }}
          unit={unitDialogDraft}
        />
      ) : null}
    </>
  );
}

function BuildingTable({
  buildings,
  canEdit,
  metrics,
  selectedBuilding,
  onArchive,
  onAddUnit,
  onDelete,
  onEdit,
  onOpen,
  onRestore,
  startIndex
}: {
  buildings: Building[];
  canEdit: boolean;
  metrics: Map<string, BuildingMetric>;
  selectedBuilding: Building | null;
  startIndex: number;
  onArchive: (building: Building) => void;
  onAddUnit: (building: Building) => void;
  onDelete: (building: Building) => void;
  onEdit: (building: Building) => void;
  onOpen: (building: Building) => void;
  onRestore: (building: Building) => void;
}) {
  if (buildings.length === 0) {
    return <EmptyState title="No buildings found" body="Try clearing the search or location filters." />;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>No.</th>
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
          {buildings.map((building, index) => {
            const metric = metrics.get(building.id);
            const isSelected = selectedBuilding?.id === building.id;

            return (
              <tr
                className={`clickable-row ${isSelected ? "selected" : ""}`}
                key={building.id}
                onClick={() => onOpen(building)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(building);
                  }
                }}
                tabIndex={0}
              >
                <td className="row-index">{startIndex + index + 1}</td>
                <td>
                  <button
                    className="table-primary-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(building);
                    }}
                    type="button"
                  >
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
                    <button
                      className="mini-action"
                      disabled={!canEdit}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(building);
                      }}
                      type="button"
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      className="mini-action"
                      disabled={!canEdit}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddUnit(building);
                      }}
                      type="button"
                    >
                      <Plus size={14} />
                      Add unit
                    </button>
                    {building.is_active ? (
                      <button
                        className="icon-button"
                        disabled={!canEdit}
                        onClick={(event) => {
                          event.stopPropagation();
                          onArchive(building);
                        }}
                        title="Archive"
                        type="button"
                      >
                        <Archive size={15} />
                      </button>
                    ) : (
                      <button
                        className="icon-button"
                        disabled={!canEdit}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRestore(building);
                        }}
                        title="Activate"
                        type="button"
                      >
                        <Check size={15} />
                      </button>
                    )}
                    <button
                      className="icon-button danger"
                      disabled={!canEdit}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(building);
                      }}
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

function BuildingEditorDialog({
  canEdit,
  draft,
  isSaving,
  neighborhoods,
  updateDraft,
  onArchive,
  onClose,
  onRestore,
  onSave
}: {
  canEdit: boolean;
  draft: Building;
  isSaving: boolean;
  neighborhoods: Neighborhood[];
  updateDraft: <K extends keyof Building>(key: K, value: Building[K]) => void;
  onArchive: () => void;
  onClose: () => void;
  onRestore: () => void;
  onSave: () => void;
}) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="side-drawer building-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <div className="eyebrow">Building profile</div>
            <h3>{draft.id.startsWith("new-") ? "New building" : draft.name}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>
        <div className="drawer-body">
          <BuildingEditor
            canEdit={canEdit}
            draft={draft}
            isSaving={isSaving}
            neighborhoods={neighborhoods}
            onArchive={onArchive}
            onRestore={onRestore}
            onSave={onSave}
            updateDraft={updateDraft}
          />
        </div>
      </aside>
    </div>
  );
}

function UnitManager({
  buildingsByID,
  units,
  canEdit,
  filteredCount,
  pageMeta,
  onPageChange,
  onEditUnit,
  totalCount
}: {
  buildingsByID: Map<string, Building>;
  units: UnitWithListing[];
  canEdit: boolean;
  filteredCount: number;
  pageMeta: PaginationMeta;
  onPageChange: (page: number) => void;
  onEditUnit: (unit: UnitWithListing) => void;
  totalCount: number;
}) {
  return (
    <section className="data-panel units-list-panel global-units-panel">
      <div className="panel-heading compact">
        <div>
          <div className="eyebrow">Unit list</div>
          <h3>All units</h3>
        </div>
        <span className="count-pill">
          {filteredCount} / {totalCount} shown
        </span>
      </div>

      {units.length === 0 ? (
        <EmptyState title="No units found" body="Try clearing the unit filters or search terms." />
      ) : (
        <div className="unit-table-wrap">
          <div className="unit-table global-unit-table">
            <div className="unit-table-head">
              <span>Unit</span>
              <span>Building</span>
              <span>Layout</span>
              <span>Price</span>
              <span>Deal</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {units.map((unit) => (
              <UnitListingRow
                building={buildingsByID.get(unit.building_id) ?? null}
                canEdit={canEdit}
                key={unit.id}
                onEditUnit={onEditUnit}
                unit={unit}
              />
            ))}
          </div>
        </div>
      )}
      <PaginationControls label="units" pageMeta={pageMeta} onPageChange={onPageChange} />
    </section>
  );
}

function UnitListingRow({
  building,
  unit,
  canEdit,
  onEditUnit
}: {
  building: Building | null;
  unit: UnitWithListing;
  canEdit: boolean;
  onEditUnit: (unit: UnitWithListing) => void;
}) {
  const listing = unit.listing ?? defaultListing(unit.id);

  return (
    <div
      className="unit-table-row unit-table-row-readonly clickable-row"
      onClick={() => onEditUnit(unit)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEditUnit(unit);
        }
      }}
      tabIndex={0}
    >
      <div className="unit-cell unit-identity">
        <button
          className="table-primary-link unit-number-link"
          onClick={(event) => {
            event.stopPropagation();
            onEditUnit(unit);
          }}
          type="button"
        >
          {unit.unit_number || "No unit #"}
        </button>
        <div className="table-subtext">{unit.name || "Untitled unit"}</div>
      </div>
      <div className="unit-cell unit-summary-cell">
        <strong>{building?.name ?? "Unknown building"}</strong>
        <span>{building ? `${building.area || building.city}, ${building.state}` : "Building missing"}</span>
      </div>
      <div className="unit-cell unit-summary-cell">
        <strong>
          {unit.bedroom_count} bd / {unit.bathroom_count} ba
        </strong>
        <span>{unit.sqft ? `${unit.sqft.toLocaleString()} sqft` : "Sqft not set"}</span>
      </div>
      <div className="unit-cell unit-summary-cell">
        <strong>{formatMoneyFromCents(listing.net_price_cents)}</strong>
        <span>Market {formatMoneyFromCents(listing.market_price_cents)}</span>
        <span>Cashback {formatMoneyFromCents(listing.cash_back_cents)}</span>
      </div>
      <div className="unit-cell unit-summary-cell">
        <strong>{listing.lease_deal || "No deal"}</strong>
        <span>{listing.available_from ? `Move in ${formatDate(listing.available_from)}` : "Move-in not set"}</span>
      </div>
      <div className="unit-cell">
        <span className={`status-pill ${listing.status === "available" ? "active" : "suspended"}`}>
          {listing.status}
        </span>
      </div>
      <div className="unit-cell unit-actions">
        <button
          className="mini-action"
          disabled={!canEdit}
          onClick={(event) => {
            event.stopPropagation();
            onEditUnit(unit);
          }}
          type="button"
        >
          <Pencil size={14} />
          Edit card
        </button>
      </div>
    </div>
  );
}

function UnitEditorDialog({
  building,
  unit,
  canEdit,
  onClose,
  onSaved
}: {
  building: Building | null;
  unit: UnitWithListing;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
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

    const isNew = nextDraft.id.startsWith("new-");
    const buildingID = building?.id ?? nextDraft.building_id;

    if (isNew && !building) {
      setError("Choose a building before creating a unit.");
      setIsSaving(false);
      return;
    }

    const unitPayload = {
      building_id: buildingID,
      unit_number: nextDraft.unit_number,
      name: nextDraft.name || `Unit ${nextDraft.unit_number}`,
      description: nextDraft.description,
      bedroom_count: nextDraft.bedroom_count,
      bathroom_count: nextDraft.bathroom_count,
      sqft: nextDraft.sqft,
      floor: nextDraft.floor,
      description_labels: nextDraft.description_labels
    };

    const unitResult = isNew
      ? await supabase.from("units").insert(unitPayload).select("*").single()
      : await supabase
          .from("units")
          .update({
            unit_number: nextDraft.unit_number,
            name: unitPayload.name,
            description: unitPayload.description,
            bedroom_count: unitPayload.bedroom_count,
            bathroom_count: unitPayload.bathroom_count,
            sqft: unitPayload.sqft,
            floor: unitPayload.floor,
            description_labels: unitPayload.description_labels
          })
          .eq("id", nextDraft.id)
          .select("*")
          .single();

    if (unitResult.error) {
      setError(unitResult.error.message);
      setIsSaving(false);
      return;
    }

    const savedUnit = unitResult.data as Unit;
    const listing = nextDraft.listing ? { ...defaultListing(savedUnit.id), ...nextDraft.listing, unit_id: savedUnit.id } : null;

    if (listing) {
      const listingPayload = {
        unit_id: savedUnit.id,
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

      const listingResult =
        listing.id && !isNew
          ? await supabase.from("unit_listings").update(listingPayload).eq("id", listing.id)
          : await supabase.from("unit_listings").insert(listingPayload);

      if (listingResult.error) {
        setError(listingResult.error.message);
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    await onSaved();
    onClose();
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

    if (draft.id.startsWith("new-")) {
      onClose();
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

    await onSaved();
    onClose();
  }

  const listing = draft.listing ?? defaultListing(draft.id);

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="side-drawer unit-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <div className="eyebrow">{building?.name ?? "Unknown building"}</div>
            <h3>{draft.id.startsWith("new-") ? "Add unit" : `Unit ${draft.unit_number}`}</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={16} />
          </button>
        </header>

        <div className="drawer-body">
          {error ? <div className="message error compact-message">{error}</div> : null}

          <section className="unit-editor-card">
            <div className="form-section-title">Unit</div>
            <div className="form-grid dense">
              <InputField
                disabled={!canEdit}
                label="Unit number"
                value={draft.unit_number}
                onChange={(value) => setDraft((current) => ({ ...current, unit_number: value }))}
              />
              <InputField
                disabled={!canEdit}
                label="Display name"
                value={draft.name}
                onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
              />
              <NumberField
                disabled={!canEdit}
                label="Floor"
                value={draft.floor}
                onChange={(value) => setDraft((current) => ({ ...current, floor: value == null ? null : Math.round(value) }))}
              />
              <InputField
                disabled={!canEdit}
                label="Description labels"
                value={stringArrayToInput(draft.description_labels)}
                onChange={(value) => setDraft((current) => ({ ...current, description_labels: toStringArray(value) }))}
              />
            </div>
          </section>

          <section className="unit-editor-card">
            <div className="form-section-title">Layout</div>
            <div className="form-grid dense three">
              <NumberField
                disabled={!canEdit}
                label="Bedrooms"
                value={draft.bedroom_count}
                onChange={(value) => setDraft((current) => ({ ...current, bedroom_count: value ?? 0 }))}
              />
              <NumberField
                disabled={!canEdit}
                label="Bathrooms"
                step="0.5"
                value={draft.bathroom_count}
                onChange={(value) => setDraft((current) => ({ ...current, bathroom_count: value ?? 0 }))}
              />
              <NumberField
                disabled={!canEdit}
                label="Sqft"
                value={draft.sqft}
                onChange={(value) => setDraft((current) => ({ ...current, sqft: value == null ? null : Math.round(value) }))}
              />
            </div>
          </section>

          <section className="unit-editor-card">
            <div className="form-section-title">Price</div>
            <div className="form-grid dense three">
              <CentsInput
                disabled={!canEdit}
                label="Market"
                value={listing.market_price_cents}
                onChange={(value) => updateListing("market_price_cents", value)}
              />
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
          </section>

          <section className="unit-editor-card">
            <div className="form-section-title">Deal and status</div>
            <div className="form-grid dense">
              <InputField
                disabled={!canEdit}
                label="Lease deal"
                value={listing.lease_deal ?? ""}
                onChange={(value) => updateListing("lease_deal", value || null)}
              />
              <NumberField
                disabled={!canEdit}
                label="Free months"
                step="0.5"
                value={listing.free_months}
                onChange={(value) => updateListing("free_months", value ?? 0)}
              />
              <InputField
                disabled={!canEdit}
                label="Available from"
                type="date"
                value={listing.available_from ?? ""}
                onChange={(value) => updateListing("available_from", value || null)}
              />
              <label className="field">
                <span>Status</span>
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
              </label>
            </div>
          </section>
        </div>

        <footer className="drawer-footer">
          <button className="ghost-button" disabled={!canEdit || isSaving} onClick={unlistUnit} type="button">
            <EyeOff size={15} />
            Unlist
          </button>
          <button className="ghost-button" disabled={!canEdit || isSaving} onClick={publishUnit} type="button">
            <UploadCloud size={15} />
            Publish
          </button>
          <button className="danger-button" disabled={!canEdit || isSaving} onClick={deleteUnit} type="button">
            <Trash2 size={15} />
            Delete
          </button>
          <button className="button" disabled={!canEdit || isSaving} onClick={() => persistUnit(draft)} type="button">
            <Save size={15} />
            {isSaving ? "Saving..." : "Save"}
          </button>
        </footer>
      </aside>
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

type PaginationMeta = {
  currentPage: number;
  pageCount: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
  total: number;
};

function paginationMeta(total: number, requestedPage: number, pageSize: number): PaginationMeta {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, requestedPage), pageCount);
  const startIndex = total === 0 ? 0 : (currentPage - 1) * pageSize;
  const endIndex = total === 0 ? 0 : Math.min(startIndex + pageSize, total);

  return {
    currentPage,
    pageCount,
    pageSize,
    startIndex,
    endIndex,
    total
  };
}

function PaginationControls({
  label,
  onPageChange,
  pageMeta
}: {
  label: string;
  onPageChange: (page: number) => void;
  pageMeta: PaginationMeta;
}) {
  return (
    <div className="pagination-bar">
      <span>
        {pageMeta.total === 0
          ? `No ${label}`
          : `Showing ${pageMeta.startIndex + 1}-${pageMeta.endIndex} of ${pageMeta.total} ${label}`}
      </span>
      <div className="pagination-actions">
        <button
          className="ghost-button compact-button"
          disabled={pageMeta.currentPage <= 1}
          onClick={() => onPageChange(pageMeta.currentPage - 1)}
          type="button"
        >
          Previous
        </button>
        <strong>
          {pageMeta.currentPage} / {pageMeta.pageCount}
        </strong>
        <button
          className="ghost-button compact-button"
          disabled={pageMeta.currentPage >= pageMeta.pageCount}
          onClick={() => onPageChange(pageMeta.currentPage + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function createUnitDraft(building: Building): UnitWithListing {
  const now = new Date().toISOString();
  const draftID = `new-unit-${Date.now()}`;

  return {
    id: draftID,
    building_id: building.id,
    unit_number: "",
    name: "",
    description: null,
    bedroom_count: 1,
    bathroom_count: 1,
    sqft: null,
    floor: null,
    description_labels: [],
    created_at: now,
    updated_at: now,
    listing: defaultListing(draftID)
  };
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
