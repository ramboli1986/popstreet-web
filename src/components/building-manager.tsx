"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  type UIEvent
} from "react";
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  ImageIcon,
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
  slugify
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  buildingDescriptionLabelGroups,
  buildingDescriptionLabelKey,
  buildingDescriptionLabelOptions,
  normalizeBuildingDescriptionLabel,
  normalizeBuildingDescriptionLabels,
  toggleBuildingDescriptionLabel
} from "@/lib/building-description-labels";
import {
  normalizeUnitDescriptionLabel,
  normalizeUnitDescriptionLabels,
  toggleUnitDescriptionLabel,
  unitDescriptionLabelGroups,
  unitDescriptionLabelKey,
  unitDescriptionLabelOptions
} from "@/lib/unit-description-labels";
import type {
  AccountProfile,
  Building,
  BuildingImage,
  BuildingImageKind,
  BuildingService,
  BuildingTransitLine,
  ListingStatus,
  ManagementCompany,
  Neighborhood,
  Unit,
  UnitImage,
  UnitImageKind,
  UnitListing,
  UnitWithListing
} from "@/lib/types";

type BuildingManagerProps = {
  profile: AccountProfile | null;
  mode: "building" | "units" | "map";
};

type UnitIndex = Pick<Unit, "id" | "building_id">;
type BuildingMetric = {
  unitCount: number;
  availableCount: number;
  minNetPrice: number | null;
  latestListingAt: string | null;
};
type UnitStatusFilter = "all" | "listed" | "unlisted";
type UnitBedroomFilter = "all" | "0" | "1" | "2" | "3plus";
type BuildingUnitListFilter = "all" | "listed" | "unlisted";
type BuildingServiceOption = {
  title: string;
  label: string;
  systemImageName: string;
};

const listingStatuses: ListingStatus[] = ["available", "pending", "unavailable", "rented", "archived"];
const buildingMediaBucket = "building-media";
const acceptedBuildingImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const buildingImageKinds: BuildingImageKind[] = [
  "avatar",
  "gallery",
  "exterior",
  "lobby",
  "amenity",
  "gym",
  "rooftop",
  "pool",
  "common_area",
  "neighborhood",
  "cover"
];
const unitImageKinds: UnitImageKind[] = [
  "photo",
  "living_room",
  "bedroom",
  "kitchen",
  "bathroom",
  "closet",
  "balcony",
  "view",
  "floor_plan"
];
const transitLineOptions = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "A",
  "C",
  "E",
  "B",
  "D",
  "F",
  "M",
  "G",
  "J",
  "Z",
  "L",
  "N",
  "Q",
  "R",
  "W",
  "S",
  "PATH",
  "HBLR",
  "LIRR",
  "Light Rail"
];
const buildingServiceOptions = [
  { title: "AMENITIES", label: "Amenities", systemImageName: "building.columns" },
  { title: "DOORMAN", label: "Doorman", systemImageName: "door.left.hand.open" },
  { title: "STAFF", label: "Staff", systemImageName: "person.2" },
  { title: "GYM", label: "Gym", systemImageName: "dumbbell" },
  { title: "POOL", label: "Pool", systemImageName: "water.waves" },
  { title: "ROOFTOP", label: "Rooftop", systemImageName: "building.2" },
  { title: "PETS", label: "Pets", systemImageName: "pawprint" },
  { title: "BIKES", label: "Bikes", systemImageName: "bicycle" }
];
const leaseMonthOptions = Array.from({ length: 15 }, (_item, index) => index + 10);
const freeMonthOptions = Array.from({ length: 13 }, (_item, index) => index * 0.5);
const buildingBatchSize = 25;
const unitBatchSize = 25;
const preferredMapAreas = [
  "Jersey City",
  "LIC",
  "Brooklyn",
  "Downtown Manhattan",
  "Midtown Manhattan",
  "Upper West Side",
  "Upper East Side",
  "Flushing"
];
const mapAreaPalette = [
  "#4da3df",
  "#8057e8",
  "#f2a22a",
  "#e64f4b",
  "#52b97e",
  "#df519b",
  "#5f6be8",
  "#54b9ad",
  "#64748b",
  "#14b8a6"
];

export function BuildingManager({ profile, mode }: BuildingManagerProps) {
  const { language, t } = useI18n();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingImages, setBuildingImages] = useState<BuildingImage[]>([]);
  const [buildingServices, setBuildingServices] = useState<BuildingService[]>([]);
  const [buildingTransitLines, setBuildingTransitLines] = useState<BuildingTransitLine[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [managementCompanies, setManagementCompanies] = useState<ManagementCompany[]>([]);
  const [unitIndex, setUnitIndex] = useState<UnitIndex[]>([]);
  const [listingIndex, setListingIndex] = useState<UnitListing[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [draft, setDraft] = useState<Building | null>(null);
  const [units, setUnits] = useState<UnitWithListing[]>([]);
  const [unitImages, setUnitImages] = useState<UnitImage[]>([]);
  const [isBuildingEditorOpen, setIsBuildingEditorOpen] = useState(false);
  const [unitListBuilding, setUnitListBuilding] = useState<Building | null>(null);
  const [unitDialogDraft, setUnitDialogDraft] = useState<UnitWithListing | null>(null);
  const [publicationUnitID, setPublicationUnitID] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [unitSearch, setUnitSearch] = useState("");
  const [unitBuildingFilter, setUnitBuildingFilter] = useState("all");
  const [unitStatusFilter, setUnitStatusFilter] = useState<UnitStatusFilter>("listed");
  const [unitBedroomFilter, setUnitBedroomFilter] = useState<UnitBedroomFilter>("all");
  const [visibleBuildingCount, setVisibleBuildingCount] = useState(buildingBatchSize);
  const [visibleUnitCount, setVisibleUnitCount] = useState(unitBatchSize);
  const [selectedMapArea, setSelectedMapArea] = useState("all");
  const [mapResetSignal, setMapResetSignal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingBuildingID, setUploadingBuildingID] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = canEditInventory(profile?.role, profile?.account_kind, profile?.status);

  const loadBuildings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [
      buildingResult,
      neighborhoodResult,
      companyResult,
      unitResult,
      listingResult,
      buildingImageResult,
      buildingServiceResult,
      buildingTransitResult
    ] = await Promise.all([
      supabase
        .from("buildings")
        .select("*, neighborhoods(name, slug), management_companies(id, slug, name, website)")
        .order("updated_at", { ascending: false })
        .limit(800),
      supabase.from("neighborhoods").select("id, slug, name, city, state").order("name"),
      supabase.from("management_companies").select("*").order("name"),
      supabase.from("units").select("id, building_id").limit(5000),
      supabase.from("unit_listings").select("*").order("updated_at", { ascending: false }).limit(5000),
      supabase.from("building_images").select("*").order("sort_order").limit(10000),
      supabase.from("building_services").select("*").order("sort_order").limit(10000),
      supabase.from("building_transit_lines").select("*").order("sort_order").limit(10000)
    ]);

    setIsLoading(false);

    if (
      buildingResult.error ||
      neighborhoodResult.error ||
      companyResult.error ||
      unitResult.error ||
      listingResult.error ||
      buildingImageResult.error ||
      buildingServiceResult.error ||
      buildingTransitResult.error
    ) {
      setError(
        buildingResult.error?.message ??
          neighborhoodResult.error?.message ??
          companyResult.error?.message ??
          unitResult.error?.message ??
          listingResult.error?.message ??
          buildingImageResult.error?.message ??
          buildingServiceResult.error?.message ??
          buildingTransitResult.error?.message ??
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
    setManagementCompanies((companyResult.data ?? []) as ManagementCompany[]);
    setUnitIndex((unitResult.data ?? []) as UnitIndex[]);
    setListingIndex((listingResult.data ?? []) as UnitListing[]);
    setBuildingImages((buildingImageResult.data ?? []) as BuildingImage[]);
    setBuildingServices((buildingServiceResult.data ?? []) as BuildingService[]);
    setBuildingTransitLines((buildingTransitResult.data ?? []) as BuildingTransitLine[]);
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
      setUnitImages([]);
      return;
    }

    const [listingResult, imageResult] = await Promise.all([
      supabase.from("unit_listings").select("*").order("updated_at", { ascending: false }).limit(10000),
      supabase.from("unit_images").select("*").order("sort_order").limit(20000)
    ]);

    if (listingResult.error || imageResult.error) {
      setError(listingResult.error?.message ?? imageResult.error?.message ?? "Could not load unit details.");
      setUnits(baseUnits.map((unit) => ({ ...unit, listing: null })));
      if (imageResult.data) {
        setUnitImages(imageResult.data as UnitImage[]);
      }
      return;
    }

    const listingsByUnit = new Map<string, UnitListing>();
    const nextListings = (listingResult.data ?? []) as UnitListing[];

    nextListings.forEach((listing) => {
      if (!listingsByUnit.has(listing.unit_id)) {
        listingsByUnit.set(listing.unit_id, listing);
      }
    });

    setListingIndex(nextListings);
    setUnitImages((imageResult.data ?? []) as UnitImage[]);
    setUnits(baseUnits.map((unit) => ({ ...unit, listing: listingsByUnit.get(unit.id) ?? null })));
  }, []);

  useEffect(() => {
    loadBuildings();
  }, []);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    setVisibleBuildingCount(buildingBatchSize);
  }, [companyFilter, locationFilter, search]);

  useEffect(() => {
    setVisibleUnitCount(unitBatchSize);
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

  const locationOptions = useMemo(() => {
    const labels = new Set<string>();

    buildings.forEach((building) => {
      if (building.city) {
        labels.add(building.city);
      }
    });

    return Array.from(labels).sort((first, second) => first.localeCompare(second));
  }, [buildings]);

  const companyOptions = useMemo(() => {
    const options = new Map<string, string>();

    buildings.forEach((building) => {
      options.set(buildingCompanyFilterValue(building), buildingCompanyName(building));
    });

    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((first, second) => first.label.localeCompare(second.label));
  }, [buildings]);

  const mapAreaOptions = useMemo(() => {
    const labels = new Set<string>();

    buildings.forEach((building) => {
      const label = buildingAreaLabel(building);
      if (label) {
        labels.add(label);
      }
    });

    const sorted = Array.from(labels).sort((first, second) => {
      const firstPreferredIndex = preferredMapAreas.indexOf(first);
      const secondPreferredIndex = preferredMapAreas.indexOf(second);

      if (firstPreferredIndex !== -1 || secondPreferredIndex !== -1) {
        return (firstPreferredIndex === -1 ? 999 : firstPreferredIndex) - (secondPreferredIndex === -1 ? 999 : secondPreferredIndex);
      }

      return first.localeCompare(second);
    });

    return sorted.map((area, index) => ({
      area,
      color: areaColor(area, index)
    }));
  }, [buildings]);

  const mapAreaColors = useMemo(
    () => new Map(mapAreaOptions.map((option) => [option.area, option.color])),
    [mapAreaOptions]
  );

  useEffect(() => {
    setSelectedMapArea((current) => {
      if (current === "all") {
        return current;
      }

      return mapAreaOptions.some((option) => option.area === current) ? current : "all";
    });
  }, [mapAreaOptions]);

  const filteredBuildings = useMemo(() => {
    const query = search.trim().toLowerCase();

    return buildings.filter((building) => {
      const areaLabel = building.area || building.neighborhoods?.name || building.city;
      const companyName = buildingCompanyName(building);
      const matchesCompany = companyFilter === "all" || buildingCompanyFilterValue(building) === companyFilter;
      const matchesLocation = locationFilter === "all" || building.city === locationFilter;
      const matchesSearch =
        query.length === 0 ||
        [building.name, building.address, building.full_address, areaLabel, companyName, building.city, building.state]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));

      return matchesCompany && matchesLocation && matchesSearch;
    });
  }, [buildings, companyFilter, locationFilter, search]);

  const filteredAvailableUnitCount = useMemo(
    () =>
      filteredBuildings.reduce((total, building) => total + (buildingMetrics.get(building.id)?.availableCount ?? 0), 0),
    [buildingMetrics, filteredBuildings]
  );
  const geocodedBuildings = useMemo(
    () => buildings.filter((building) => Number.isFinite(building.latitude) && Number.isFinite(building.longitude)),
    [buildings]
  );
  const visibleMapBuildings = useMemo(
    () =>
      selectedMapArea === "all"
        ? geocodedBuildings
        : geocodedBuildings.filter((building) => buildingAreaLabel(building) === selectedMapArea),
    [geocodedBuildings, selectedMapArea]
  );

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase();

    return units.filter((unit) => {
      const building = buildingByID.get(unit.building_id);
      const listing = unit.listing ?? defaultListing(unit.id);
      const isListed = isListedUnit(unit);
      const matchesBuilding = unitBuildingFilter === "all" || unit.building_id === unitBuildingFilter;
      const matchesStatus =
        unitStatusFilter === "all" ||
        (unitStatusFilter === "listed" ? isListed : !isListed);
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
          leaseDealLabel(listing.lease_months, listing.free_months)
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

  const visibleBuildings = useMemo(
    () => filteredBuildings.slice(0, visibleBuildingCount),
    [filteredBuildings, visibleBuildingCount]
  );

  const visibleUnits = useMemo(
    () => filteredUnits.slice(0, visibleUnitCount),
    [filteredUnits, visibleUnitCount]
  );

  const selectedUnitFilterBuilding = useMemo(
    () => (unitBuildingFilter === "all" ? null : buildings.find((building) => building.id === unitBuildingFilter) ?? null),
    [buildings, unitBuildingFilter]
  );

  const unitDialogBuilding = useMemo(
    () => (unitDialogDraft ? buildingByID.get(unitDialogDraft.building_id) ?? selectedBuilding : null),
    [buildingByID, selectedBuilding, unitDialogDraft]
  );

  const buildingImagesForDraft = useMemo(
    () =>
      draft
        ? buildingImagesWithCoverFallback(
            draft,
            buildingImages.filter((image) => image.building_id === draft.id)
          ).sort(compareMediaImageRows)
        : [],
    [buildingImages, draft]
  );
  const buildingServicesForDraft = useMemo(
    () =>
      draft
        ? buildingServices.filter((service) => service.building_id === draft.id).sort(compareSortableRows)
        : [],
    [buildingServices, draft]
  );
  const buildingTransitLinesForDraft = useMemo(
    () =>
      draft
        ? buildingTransitLines.filter((line) => line.building_id === draft.id).sort(compareSortableRows)
        : [],
    [buildingTransitLines, draft]
  );

  const unitImagesForDialog = useMemo(
    () =>
      unitDialogDraft
        ? unitImages.filter((image) => image.unit_id === unitDialogDraft.id).sort(compareMediaImageRows)
        : [],
    [unitDialogDraft, unitImages]
  );

  const unitListUnits = useMemo(
    () => (unitListBuilding ? units.filter((unit) => unit.building_id === unitListBuilding.id) : []),
    [unitListBuilding, units]
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

  function updateBuildingImageDrafts(nextImages: BuildingImage[]) {
    if (!draft) {
      return;
    }

    updateDraft("cover_image_url", coverImageURLFromImages(nextImages));
    setBuildingImages((current) => [
      ...current.filter((image) => image.building_id !== draft.id),
      ...nextImages
    ]);
  }

  async function uploadBuildingImages(building: Building, files: File[], kind: BuildingImageKind) {
    if (!canEdit || building.id.startsWith("new-")) {
      return;
    }

    const imageFiles = files.filter((file) => acceptedBuildingImageTypes.includes(file.type));

    if (imageFiles.length === 0) {
      setError("Choose JPG, PNG, WebP, or GIF images to upload.");
      return;
    }

    setUploadingBuildingID(building.id);
    setError(null);
    setMessage(null);

    const existingImages = buildingImages.filter((image) => image.building_id === building.id);
    let nextSortOrder = nextMediaSortOrder(existingImages);
    let nextCoverSortOrder = firstMediaSortOrder(existingImages) - imageFiles.length * 10;
    const uploadedImages: BuildingImage[] = [];

    try {
      for (const file of imageFiles) {
        const objectPath = buildingMediaObjectPath(building, file);
        const sortOrder = kind === "cover" ? nextCoverSortOrder : nextSortOrder;
        const { error: uploadError } = await supabase.storage.from(buildingMediaBucket).upload(objectPath, file, {
          cacheControl: "31536000",
          contentType: file.type,
          upsert: false
        });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        const publicURL = supabase.storage.from(buildingMediaBucket).getPublicUrl(objectPath).data.publicUrl;
        const { data: imageRow, error: imageError } = await supabase
          .from("building_images")
          .insert({
            building_id: building.id,
            kind,
            url: publicURL,
            alt_text: `${building.name} ${imageKindLabel(kind)}`,
            sort_order: sortOrder
          })
          .select("*")
          .single();

        if (imageError) {
          await supabase.storage.from(buildingMediaBucket).remove([objectPath]);
          throw new Error(imageError.message);
        }

        uploadedImages.push(imageRow as BuildingImage);
        nextSortOrder += 10;
        nextCoverSortOrder += 10;
      }

      const nextImages = normalizeMediaSort([...existingImages, ...uploadedImages]);
      const nextCoverImageURL = coverImageURLFromImages(nextImages);

      if (kind === "cover" && nextCoverImageURL) {
        const { error: coverError } = await supabase
          .from("buildings")
          .update({ cover_image_url: nextCoverImageURL })
          .eq("id", building.id);

        if (coverError) {
          throw new Error(coverError.message);
        }

        setBuildings((current) =>
          current.map((item) => (item.id === building.id ? { ...item, cover_image_url: nextCoverImageURL } : item))
        );
        setSelectedBuilding((current) =>
          current?.id === building.id ? { ...current, cover_image_url: nextCoverImageURL } : current
        );
        setDraft((current) => (current?.id === building.id ? { ...current, cover_image_url: nextCoverImageURL } : current));
      }

      setBuildingImages((current) => [
        ...current.filter((image) => image.building_id !== building.id),
        ...nextImages
      ]);
      setMessage(`${uploadedImages.length} image${uploadedImages.length === 1 ? "" : "s"} uploaded to ${building.name}.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Images could not be uploaded.");
    } finally {
      setUploadingBuildingID(null);
    }
  }

  function updateBuildingServiceDrafts(nextServices: BuildingService[]) {
    if (!draft) {
      return;
    }

    setBuildingServices((current) => [
      ...current.filter((service) => service.building_id !== draft.id),
      ...nextServices
    ]);
  }

  function updateBuildingTransitLineDrafts(nextLines: BuildingTransitLine[]) {
    if (!draft) {
      return;
    }

    setBuildingTransitLines((current) => [
      ...current.filter((line) => line.building_id !== draft.id),
      ...nextLines
    ]);
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
      convenience_score: 75,
      activity_score: 55,
      summary: "",
      description_labels: [],
      cover_image_url: null,
      is_active: true,
      year_built: null,
      total_floors: null,
      total_units: null,
      management_company_id: null,
      management_company: null,
      website: null,
      area: "",
      leasing_email: null,
      leasing_phone: null,
      leasing_contact_name: null,
      tour_booking_url: null,
      application_url: null,
      application_fee_cents: null,
      tour_schedule_notes: null,
      tour_data_source: "manual",
      created_at: now,
      updated_at: now,
      neighborhoods: null,
      management_companies: null
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

    const imagesForDraft = buildingImagesWithCoverFallback(
      draft,
      buildingImages.filter((image) => image.building_id === draft.id)
    );
    const payload = buildingPayload(draft, imagesForDraft);
    const isNew = draft.id.startsWith("new-");
    const result = isNew
      ? await supabase
          .from("buildings")
          .insert(payload)
          .select("*, neighborhoods(name, slug), management_companies(id, slug, name, website)")
          .single()
      : await supabase
          .from("buildings")
          .update(payload)
          .eq("id", draft.id)
          .select("*, neighborhoods(name, slug), management_companies(id, slug, name, website)")
          .single();

    if (result.error) {
      setIsSaving(false);
      setError(result.error.message);
      return;
    }

    const savedBuilding = result.data as Building;
    const servicesForDraft = buildingServices.filter((service) => service.building_id === draft.id);
    const transitLinesForDraft = buildingTransitLines.filter((line) => line.building_id === draft.id);
    let syncedImages: BuildingImage[] = [];
    let syncedServices: BuildingService[] = [];
    let syncedTransitLines: BuildingTransitLine[] = [];

    try {
      syncedImages = await syncBuildingImages(savedBuilding.id, imagesForDraft);
      syncedServices = await syncBuildingServices(savedBuilding.id, servicesForDraft);
      syncedTransitLines = await syncBuildingTransitLines(savedBuilding.id, transitLinesForDraft);
    } catch (syncError) {
      setIsSaving(false);
      setError(syncError instanceof Error ? syncError.message : "Building saved, but related fields could not be saved.");
      return;
    }

    setIsSaving(false);
    setMessage(isNew ? "Building created." : "Building saved.");
    setBuildings((current) => {
      const withoutDraft = current.filter((building) => building.id !== draft.id && building.id !== savedBuilding.id);
      return [savedBuilding, ...withoutDraft];
    });
    setBuildingImages((current) => [
      ...current.filter((image) => image.building_id !== draft.id && image.building_id !== savedBuilding.id),
      ...syncedImages
    ]);
    setBuildingServices((current) => [
      ...current.filter((service) => service.building_id !== draft.id && service.building_id !== savedBuilding.id),
      ...syncedServices
    ]);
    setBuildingTransitLines((current) => [
      ...current.filter((line) => line.building_id !== draft.id && line.building_id !== savedBuilding.id),
      ...syncedTransitLines
    ]);
    setSelectedBuilding(savedBuilding);
    setDraft({ ...savedBuilding });
    setIsBuildingEditorOpen(false);
  }

  function openBuildingEditor(building: Building) {
    selectBuilding(building);
    setIsBuildingEditorOpen(true);
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
    setBuildingImages((current) => current.filter((image) => image.building_id !== building.id));
    setBuildingServices((current) => current.filter((service) => service.building_id !== building.id));
    setBuildingTransitLines((current) => current.filter((line) => line.building_id !== building.id));
    setSelectedBuilding(nextSelected);
    setDraft(nextSelected ? { ...nextSelected } : null);
    setUnitListBuilding((current) => (current?.id === building.id ? null : current));
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

  function openUnitList(building: Building) {
    selectBuilding(building);
    setUnitListBuilding(building);
  }

  async function updateUnitPublicationFromList(unit: UnitWithListing, nextStatus: Extract<ListingStatus, "available" | "unavailable">) {
    if (!canEdit || unit.id.startsWith("new-")) {
      return;
    }

    const listing = unitListListing(unit);
    const isListed = isListedUnit(unit);

    if ((isListed && nextStatus === "available") || (!isListed && nextStatus === "unavailable")) {
      return;
    }

    setPublicationUnitID(unit.id);
    setError(null);
    setMessage(null);

    const now = new Date().toISOString();
    const listingPayload = {
      unit_id: unit.id,
      status: nextStatus,
      market_price_cents: listing.market_price_cents,
      lease_months: listing.lease_months,
      net_price_cents: listing.net_price_cents,
      free_months: listing.free_months,
      cash_back_cents: listing.cash_back_cents,
      final_price_cents: listing.final_price_cents,
      available_from: listing.available_from,
      source: listing.source || "admin",
      listed_at: nextStatus === "available" ? listing.listed_at || now : listing.listed_at,
      last_seen_at: now,
      unavailable_at: nextStatus === "available" ? null : now
    };

    const result = listing.id
      ? await supabase.from("unit_listings").update(listingPayload).eq("id", listing.id)
      : await supabase.from("unit_listings").insert(listingPayload);

    setPublicationUnitID(null);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setMessage(nextStatus === "available" ? "Unit published." : "Unit unlisted.");
    await loadUnits();
    await loadBuildings();
  }

  function openAddUnitFromUnitsPage() {
    const building =
      selectedUnitFilterBuilding ??
      (selectedBuilding && !selectedBuilding.id.startsWith("new-") ? selectedBuilding : null) ??
      buildings[0] ??
      null;

    openAddUnitDialog(building);
  }

  function selectMapArea(area: string) {
    setSelectedMapArea(area);
    setSelectedBuilding((building) => {
      if (!building || area === "all" || buildingAreaLabel(building) === area) {
        return building;
      }

      return null;
    });
  }

  const pageCopy = {
    building: {
      eyebrow: t("manager.buildingsEyebrow"),
      title: t("manager.buildingsTitle", { count: buildings.length.toLocaleString(locale) }),
      subtitle: t("manager.buildingsSubtitle", {
        companies: companyOptions.length.toLocaleString(locale),
        available: filteredAvailableUnitCount.toLocaleString(locale)
      })
    },
    units: {
      eyebrow: t("manager.unitsEyebrow"),
      title: t("manager.unitsTitle"),
      subtitle: t("manager.unitsSubtitle", {
        total: filteredUnitStats.total.toLocaleString(locale),
        available: filteredUnitStats.available.toLocaleString(locale)
      })
    },
    map: {
      eyebrow: t("manager.mapEyebrow"),
      title: t("manager.mapTitle"),
      subtitle: t("manager.mapSubtitle")
    }
  }[mode];

  if (mode === "map") {
    return (
      <>
        {error ? <div className="message error compact-message">{error}</div> : null}
        {message ? <div className="message compact-message">{message}</div> : null}

        <section className="map-redesign-shell">
          <header className="map-redesign-statusbar">
            <span>
              {t("manager.geolocated", {
                visible: visibleMapBuildings.length.toLocaleString(locale),
                total: geocodedBuildings.length.toLocaleString(locale)
              })}
            </span>
            <button className="map-reset-button" onClick={() => setMapResetSignal((value) => value + 1)} type="button">
              {t("manager.resetMapView")}
            </button>
          </header>

          <div className="map-area-toolbar">
            <span className="map-area-label">{t("manager.areas")}</span>
            <div className="map-area-scroll">
              <button
                className={`map-area-chip ${selectedMapArea === "all" ? "active" : ""}`}
                onClick={() => selectMapArea("all")}
                style={{ "--area-color": "#64748b" } as CSSProperties}
                type="button"
              >
                <span />
                {t("manager.allAreas")}
              </button>
              {mapAreaOptions.map((option) => {
                const isActive = selectedMapArea === option.area;

                return (
                  <button
                    className={`map-area-chip ${isActive ? "active" : ""}`}
                    key={option.area}
                    onClick={() => selectMapArea(option.area)}
                    style={{ "--area-color": option.color } as CSSProperties}
                    type="button"
                  >
                    <span />
                    {option.area}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="map-redesign-canvas-frame">
            <BuildingMap
              areaColors={mapAreaColors}
              buildings={visibleMapBuildings}
              canEdit={canEdit}
              onCoordinateChange={updateDraftCoordinate}
              onSelect={selectBuilding}
              resetSignal={mapResetSignal}
              selectedBuilding={selectedBuilding}
            />
          </div>

          {selectedBuilding ? (
            <aside className="map-selection-card">
              <div className="map-selection-avatar">
                {selectedBuilding.cover_image_url ? (
                  <span
                    aria-hidden="true"
                    className="map-selection-avatar-image"
                    style={{ backgroundImage: `url(${JSON.stringify(selectedBuilding.cover_image_url)})` }}
                  />
                ) : (
                  <ImageIcon aria-hidden="true" size={18} />
                )}
              </div>
              <div className="map-selection-copy">
                <span style={{ background: mapAreaColors.get(buildingAreaLabel(selectedBuilding)) }} />
                <strong>{selectedBuilding.name}</strong>
                <small>
                  {buildingAreaLabel(selectedBuilding)} · {selectedBuilding.city}, {selectedBuilding.state}
                </small>
              </div>
              <button className="ghost-button compact-button" onClick={() => openBuildingEditor(selectedBuilding)} type="button">
                {t("common.edit")}
              </button>
            </aside>
          ) : null}
        </section>

        {isBuildingEditorOpen && draft ? (
          <BuildingEditorDialog
            buildingImages={buildingImagesForDraft}
            canEdit={canEdit}
            draft={draft}
            isSaving={isSaving}
            managementCompanies={managementCompanies}
            neighborhoods={neighborhoods}
            services={buildingServicesForDraft}
            transitLines={buildingTransitLinesForDraft}
            isUploadingImages={uploadingBuildingID === draft.id}
            onClose={() => setIsBuildingEditorOpen(false)}
            onDelete={deleteBuilding}
            onImagesChange={updateBuildingImageDrafts}
            onUploadImages={uploadBuildingImages}
            onSave={saveBuilding}
            onServicesChange={updateBuildingServiceDrafts}
            onTransitLinesChange={updateBuildingTransitLineDrafts}
            updateDraft={updateDraft}
          />
        ) : null}
      </>
    );
  }

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
            {t("common.refresh")}
          </button>
          {canEdit && mode === "building" ? (
            <button className="button dark-button" onClick={createBuildingDraft} type="button">
              <Plus size={16} />
              {t("manager.newBuilding")}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="message error compact-message">{error}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}
      {!canEdit ? <div className="message compact-message">{t("manager.viewerReadOnly")}</div> : null}

      {mode === "units" ? (
        <section className="ops-toolbar unit-ops-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder={t("manager.searchUnit")}
              value={unitSearch}
              onChange={(event) => setUnitSearch(event.target.value)}
            />
          </label>
          <select value={unitBuildingFilter} onChange={(event) => setUnitBuildingFilter(event.target.value)}>
            <option value="all">{t("manager.allBuildings")}</option>
            {buildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
          <select value={unitStatusFilter} onChange={(event) => setUnitStatusFilter(event.target.value as UnitStatusFilter)}>
            {(["listed", "unlisted", "all"] as UnitStatusFilter[]).map((filter) => (
              <option key={filter} value={filter}>
                {buildingUnitFilterLabel(filter)}
              </option>
            ))}
          </select>
          <select value={unitBedroomFilter} onChange={(event) => setUnitBedroomFilter(event.target.value as UnitBedroomFilter)}>
            <option value="all">{t("manager.allLayouts")}</option>
            <option value="0">Studio</option>
            <option value="1">1 bed</option>
            <option value="2">2 bed</option>
            <option value="3plus">3+ bed</option>
          </select>
          <div className="toolbar-stat">
            <strong>{filteredUnitStats.total}</strong>
            <span>{t("common.units")}</span>
          </div>
          <div className="toolbar-stat">
            <strong>{filteredUnitStats.available}</strong>
            <span>{t("common.available")}</span>
          </div>
          {canEdit ? (
            <button className="button" disabled={buildings.length === 0} onClick={openAddUnitFromUnitsPage} type="button">
              <Plus size={16} />
              {t("manager.addUnit")}
            </button>
          ) : null}
        </section>
      ) : (
        <section className="ops-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder={t("manager.searchBuilding")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
            <option value="all">{t("manager.allCompanies")}</option>
            {companyOptions.map((company) => (
              <option key={company.value} value={company.value}>
                {company.label}
              </option>
            ))}
          </select>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
            <option value="all">{t("manager.allLocations")}</option>
            {locationOptions.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
          <div className="toolbar-stat">
            <strong>{filteredBuildings.length}</strong>
            <span>{t("common.buildings")}</span>
          </div>
          <div className="toolbar-stat">
            <strong>{filteredAvailableUnitCount}</strong>
            <span>{t("manager.availableUnits")}</span>
          </div>
        </section>
      )}

      {mode === "units" ? (
        <UnitManager
          buildingsByID={buildingByID}
          filteredCount={filteredUnits.length}
          onLoadMore={(event) =>
            handleScrollLoadMore(event, visibleUnitCount, filteredUnits.length, setVisibleUnitCount, unitBatchSize)
          }
          onEditUnit={openEditUnitDialog}
          totalCount={units.length}
          units={visibleUnits}
        />
      ) : (
        <div className={`inventory-stack ${mode === "building" ? "building-only" : ""}`}>
          <section className="data-panel building-list-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">{t("manager.buildingList")}</div>
                <h3>{t("manager.fastQueryEdit")}</h3>
              </div>
              <span className="count-pill">
                {buildings.length.toLocaleString(locale)} {t("common.total")}
              </span>
            </div>
            <BuildingTable
              buildings={visibleBuildings}
              canEdit={canEdit}
              filteredCount={filteredBuildings.length}
              metrics={buildingMetrics}
              selectedBuilding={selectedBuilding}
              onLoadMore={(event) =>
                handleScrollLoadMore(
                  event,
                  visibleBuildingCount,
                  filteredBuildings.length,
                  setVisibleBuildingCount,
                  buildingBatchSize
                )
              }
              onOpen={openBuildingEditor}
              onOpenUnits={openUnitList}
            />
          </section>

        </div>
      )}

      {isBuildingEditorOpen && draft ? (
        <BuildingEditorDialog
          buildingImages={buildingImagesForDraft}
          canEdit={canEdit}
          draft={draft}
          isSaving={isSaving}
          managementCompanies={managementCompanies}
          neighborhoods={neighborhoods}
          services={buildingServicesForDraft}
          transitLines={buildingTransitLinesForDraft}
          isUploadingImages={uploadingBuildingID === draft.id}
          onClose={() => setIsBuildingEditorOpen(false)}
          onDelete={deleteBuilding}
          onImagesChange={updateBuildingImageDrafts}
          onUploadImages={uploadBuildingImages}
          onSave={saveBuilding}
          onServicesChange={updateBuildingServiceDrafts}
          onTransitLinesChange={updateBuildingTransitLineDrafts}
          updateDraft={updateDraft}
        />
      ) : null}

      {unitListBuilding ? (
        <BuildingUnitListDialog
          building={unitListBuilding}
          canEdit={canEdit}
          onAddUnit={openAddUnitDialog}
          onClose={() => setUnitListBuilding(null)}
          onEditUnit={openEditUnitDialog}
          onUpdateUnitPublication={updateUnitPublicationFromList}
          publicationUnitID={publicationUnitID}
          units={unitListUnits}
        />
      ) : null}

      {unitDialogDraft ? (
        <UnitEditorDialog
          building={unitDialogBuilding}
          canEdit={canEdit}
          images={unitImagesForDialog}
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
  filteredCount,
  metrics,
  selectedBuilding,
  onLoadMore,
  onOpen,
  onOpenUnits,
}: {
  buildings: Building[];
  canEdit: boolean;
  filteredCount: number;
  metrics: Map<string, BuildingMetric>;
  selectedBuilding: Building | null;
  onLoadMore: (event: UIEvent<HTMLDivElement>) => void;
  onOpen: (building: Building) => void;
  onOpenUnits: (building: Building) => void;
}) {
  if (buildings.length === 0) {
    return <EmptyState title="No buildings found" body="Try clearing the search or location filters." />;
  }

  return (
    <div className="admin-table-wrap" onScroll={onLoadMore}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>Building</th>
            <th>Location</th>
            <th>Company</th>
            <th>Available</th>
            <th>Lowest net</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {buildings.map((building, index) => {
            const metric = metrics.get(building.id);
            const isSelected = selectedBuilding?.id === building.id;
            const buildingWebsite = building.website;
            const companyName = buildingCompanyName(building);

            return (
              <tr
                className={`clickable-row ${isSelected ? "selected" : ""}`}
                key={building.id}
                onClick={() => onOpenUnits(building)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenUnits(building);
                  }
                }}
                tabIndex={0}
              >
                <td className="row-index">{index + 1}</td>
                <td>
                  {buildingWebsite ? (
                    <a
                      className="table-primary-link table-name-action"
                      href={buildingWebsite}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {building.name}
                    </a>
                  ) : (
                    <span className="table-primary-text">{building.name}</span>
                  )}
                  <div className="table-subtext">{building.address}</div>
                </td>
                <td>
                  <strong>{buildingListAreaTitle(building)}</strong>
                  <div className="table-subtext">
                    {building.city}, {building.state}
                  </div>
                </td>
                <td>
                  <strong>{companyName}</strong>
                </td>
                <td>
                  <strong>{metric?.availableCount ?? 0}</strong>
                  <div className="table-subtext">{metric?.unitCount ?? 0} units</div>
                </td>
                <td>{formatMoneyFromCents(metric?.minNetPrice)}</td>
                <td>{formatDate(metric?.latestListingAt ?? building.updated_at)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="mini-action"
                      disabled={!canEdit}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(building);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      type="button"
                    >
                      <Pencil size={14} />
                      Edit building
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <LoadMoreStatus shown={buildings.length} total={filteredCount} />
    </div>
  );
}

function BuildingEditor({
  canEdit,
  draft,
  images,
  isUploadingImages,
  managementCompanies,
  neighborhoods,
  services,
  transitLines,
  onImagesChange,
  onUploadImages,
  onServicesChange,
  onTransitLinesChange,
  updateDraft
}: {
  canEdit: boolean;
  draft: Building;
  images: BuildingImage[];
  isUploadingImages: boolean;
  managementCompanies: ManagementCompany[];
  neighborhoods: Neighborhood[];
  services: BuildingService[];
  transitLines: BuildingTransitLine[];
  onImagesChange: (images: BuildingImage[]) => void;
  onUploadImages: (building: Building, files: File[], kind: BuildingImageKind) => Promise<void> | void;
  onServicesChange: (services: BuildingService[]) => void;
  onTransitLinesChange: (lines: BuildingTransitLine[]) => void;
  updateDraft: <K extends keyof Building>(key: K, value: Building[K]) => void;
}) {
  const cityOptions = useMemo(() => {
    const cities = new Set<string>();

    neighborhoods.forEach((neighborhood) => {
      if (neighborhood.city) {
        cities.add(neighborhood.city);
      }
    });

    if (draft.city) {
      cities.add(draft.city);
    }

    return Array.from(cities).sort((first, second) => first.localeCompare(second));
  }, [draft.city, neighborhoods]);

  const areaOptionsForSelectedCity = useMemo(() => {
    const options = neighborhoods
      .filter((neighborhood) => neighborhood.city === draft.city)
      .map((neighborhood) => ({
        area: neighborhood.name,
        id: neighborhood.id,
        label: neighborhood.name,
        state: neighborhood.state,
        value: neighborhood.id
      }))
      .sort((first, second) => first.label.localeCompare(second.label));

    const hasDraftArea =
      draft.area == null ||
      draft.area.length === 0 ||
      options.some((option) => option.area === draft.area || option.id === draft.neighborhood_id);

    if (!hasDraftArea && draft.area) {
      options.push({
        area: draft.area,
        id: draft.neighborhood_id ?? "",
        label: draft.area,
        state: draft.state,
        value: `custom:${draft.area}`
      });
    }

    return options;
  }, [draft.area, draft.city, draft.neighborhood_id, draft.state, neighborhoods]);

  const selectedAreaValue =
    areaOptionsForSelectedCity.find((option) => option.id && option.id === draft.neighborhood_id)?.value ??
    areaOptionsForSelectedCity.find((option) => option.area === draft.area)?.value ??
    "";

  function updateCity(city: string) {
    const cityNeighborhoods = neighborhoods.filter((neighborhood) => neighborhood.city === city);
    const nextState = cityNeighborhoods[0]?.state;
    const keepsCurrentArea = cityNeighborhoods.some(
      (neighborhood) => neighborhood.id === draft.neighborhood_id || neighborhood.name === draft.area
    );

    updateDraft("city", city);

    if (nextState && nextState !== draft.state) {
      updateDraft("state", nextState);
    }

    if (!keepsCurrentArea) {
      updateDraft("area", null);
      updateDraft("neighborhood_id", null);
    }
  }

  function updateArea(value: string) {
    const selectedArea = areaOptionsForSelectedCity.find((option) => option.value === value);

    if (!selectedArea) {
      updateDraft("area", null);
      updateDraft("neighborhood_id", null);
      return;
    }

    updateDraft("area", selectedArea.area);
    updateDraft("neighborhood_id", selectedArea.id || null);

    if (selectedArea.state && selectedArea.state !== draft.state) {
      updateDraft("state", selectedArea.state);
    }
  }

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
        <label className="field">
          <span>City</span>
          <select disabled={!canEdit} value={draft.city} onChange={(event) => updateCity(event.target.value)}>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Area</span>
          <select disabled={!canEdit} value={selectedAreaValue} onChange={(event) => updateArea(event.target.value)}>
            <option value="">None</option>
            {areaOptionsForSelectedCity.map((area) => (
              <option key={area.value} value={area.value}>
                {area.label}
              </option>
            ))}
          </select>
        </label>
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
        <NumberField
          disabled={!canEdit}
          label="Convenience score"
          max={100}
          min={0}
          step="1"
          value={draft.convenience_score}
          onChange={(value) => updateDraft("convenience_score", value)}
        />
        <NumberField
          disabled={!canEdit}
          label="Activity score"
          max={100}
          min={0}
          step="1"
          value={draft.activity_score}
          onChange={(value) => updateDraft("activity_score", value)}
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
        <label className="field">
          <span>Management company</span>
          <select
            disabled={!canEdit}
            value={draft.management_company_id ?? ""}
            onChange={(event) => {
              const company = managementCompanies.find((item) => item.id === event.target.value) ?? null;
              updateDraft("management_company_id", company?.id ?? null);
              updateDraft("management_company", company?.name ?? null);
              updateDraft("management_companies", company);
              if (company?.website && !draft.website) {
                updateDraft("website", company.website);
              }
            }}
          >
            <option value="">None</option>
            {managementCompanies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <InputField
          disabled={!canEdit}
          label="Website"
          value={draft.website ?? ""}
          onChange={(value) => updateDraft("website", value || null)}
        />
        <BuildingDescriptionLabelSelector
          canEdit={canEdit}
          value={draft.description_labels}
          onChange={(labels) => updateDraft("description_labels", labels)}
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

      <BuildingTransitLineSelector
        buildingID={draft.id}
        canEdit={canEdit}
        lines={transitLines}
        onChange={onTransitLinesChange}
      />

      <BuildingServiceSelector
        buildingID={draft.id}
        canEdit={canEdit}
        onChange={onServicesChange}
        services={services}
      />

      <BuildingImageUploader
        building={draft}
        canEdit={canEdit}
        isUploading={isUploadingImages}
        onUpload={onUploadImages}
      />

      <ImageCollectionEditor
        canEdit={canEdit}
        createImage={() => createBuildingImageDraft(draft.id, images.length)}
        helpText="Avatar is used for the circular building image in the app. Other building images are mixed into the detail gallery after unit photos."
        images={images}
        kinds={buildingImageKinds}
        onChange={onImagesChange}
        title="Building media"
      />

    </section>
  );
}

function BuildingDescriptionLabelSelector({
  canEdit,
  value,
  onChange
}: {
  canEdit: boolean;
  value: string[];
  onChange: (labels: string[]) => void;
}) {
  const [customLabel, setCustomLabel] = useState("");
  const labels = useMemo(() => normalizeBuildingDescriptionLabels(value), [value]);
  const selectedLabelKeys = useMemo(() => new Set(labels.map(buildingDescriptionLabelKey)), [labels]);
  const predefinedLabelKeys = useMemo(
    () => new Set(buildingDescriptionLabelOptions.map((option) => buildingDescriptionLabelKey(option.value))),
    []
  );
  const customLabels = useMemo(
    () => labels.filter((label) => !predefinedLabelKeys.has(buildingDescriptionLabelKey(label))),
    [labels, predefinedLabelKeys]
  );

  function toggleLabel(label: string) {
    onChange(toggleBuildingDescriptionLabel(labels, label));
  }

  function addCustomLabel() {
    const nextLabel = normalizeBuildingDescriptionLabel(customLabel);

    if (!nextLabel) {
      setCustomLabel("");
      return;
    }

    onChange(normalizeBuildingDescriptionLabels([...labels, nextLabel]));
    setCustomLabel("");
  }

  return (
    <div className="description-label-selector">
      <div className="choice-editor-head">
        <div className="form-section-title">Description labels</div>
        <span>{labels.length} selected</span>
      </div>

      {buildingDescriptionLabelGroups.map((group) => (
        <div className="description-label-group" key={group.title}>
          <div className="description-label-group-title">{group.title}</div>
          <div className="choice-grid description-label-grid">
            {group.options.map((option) => {
              const optionKey = buildingDescriptionLabelKey(option.value);

              return (
                <label className="check-option description-label-option" key={option.value}>
                  <input
                    checked={selectedLabelKeys.has(optionKey)}
                    disabled={!canEdit}
                    type="checkbox"
                    onChange={() => toggleLabel(option.value)}
                  />
                  <span>{option.value}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {customLabels.length > 0 ? (
        <div className="description-label-group">
          <div className="description-label-group-title">Custom</div>
          <div className="choice-grid description-label-grid">
            {customLabels.map((label) => (
              <label className="check-option description-label-option" key={buildingDescriptionLabelKey(label)}>
                <input checked disabled={!canEdit} type="checkbox" onChange={() => toggleLabel(label)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="choice-add-row">
        <input
          disabled={!canEdit}
          placeholder="Custom label"
          value={customLabel}
          onChange={(event) => setCustomLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustomLabel();
            }
          }}
        />
        <button className="ghost-button compact-button" disabled={!canEdit || !customLabel.trim()} onClick={addCustomLabel} type="button">
          <Plus size={14} />
          Add
        </button>
      </div>
    </div>
  );
}

function BuildingTransitLineSelector({
  buildingID,
  canEdit,
  lines,
  onChange
}: {
  buildingID: string;
  canEdit: boolean;
  lines: BuildingTransitLine[];
  onChange: (lines: BuildingTransitLine[]) => void;
}) {
  const [customLine, setCustomLine] = useState("");
  const activeLines = useMemo(
    () => new Set(lines.map((line) => normalizeChoiceValue(line.line_name))),
    [lines]
  );
  const options = useMemo(() => {
    const knownOptions = new Set(transitLineOptions.map(normalizeChoiceValue));
    const customOptions = lines
      .map((line) => line.line_name.trim())
      .filter((line) => line.length > 0 && !knownOptions.has(normalizeChoiceValue(line)));

    return [...transitLineOptions, ...customOptions];
  }, [lines]);

  function toggleLine(lineName: string, checked: boolean) {
    const normalizedLine = normalizeChoiceValue(lineName);

    if (checked) {
      if (activeLines.has(normalizedLine)) {
        return;
      }

      onChange(normalizeBuildingTransitLines([...lines, createBuildingTransitLineDraft(buildingID, lineName, lines.length)]));
      return;
    }

    onChange(normalizeBuildingTransitLines(lines.filter((line) => normalizeChoiceValue(line.line_name) !== normalizedLine)));
  }

  function addCustomLine() {
    const nextLine = customLine.trim();

    if (!nextLine || activeLines.has(normalizeChoiceValue(nextLine))) {
      setCustomLine("");
      return;
    }

    onChange(normalizeBuildingTransitLines([...lines, createBuildingTransitLineDraft(buildingID, nextLine, lines.length)]));
    setCustomLine("");
  }

  return (
    <section className="choice-editor">
      <div className="choice-editor-head">
        <div className="form-section-title">Transit / subway lines</div>
        <span>{lines.length} selected</span>
      </div>
      <div className="choice-grid transit-choice-grid">
        {options.map((lineName) => {
          const normalizedLine = normalizeChoiceValue(lineName);

          return (
            <label className="check-option" key={normalizedLine}>
              <input
                checked={activeLines.has(normalizedLine)}
                disabled={!canEdit}
                type="checkbox"
                onChange={(event) => toggleLine(lineName, event.target.checked)}
              />
              <span>{lineName}</span>
            </label>
          );
        })}
      </div>
      <div className="choice-add-row">
        <input
          disabled={!canEdit}
          placeholder="Custom line"
          value={customLine}
          onChange={(event) => setCustomLine(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustomLine();
            }
          }}
        />
        <button className="ghost-button compact-button" disabled={!canEdit || !customLine.trim()} onClick={addCustomLine} type="button">
          <Plus size={14} />
          Add
        </button>
      </div>
    </section>
  );
}

function BuildingServiceSelector({
  buildingID,
  canEdit,
  services,
  onChange
}: {
  buildingID: string;
  canEdit: boolean;
  services: BuildingService[];
  onChange: (services: BuildingService[]) => void;
}) {
  const activeServices = useMemo(
    () => new Set(services.map((service) => normalizeChoiceValue(service.title))),
    [services]
  );
  const options = useMemo(() => {
    const predefined = new Map(buildingServiceOptions.map((option) => [normalizeChoiceValue(option.title), option]));

    services.forEach((service) => {
      const normalizedTitle = normalizeChoiceValue(service.title);

      if (!predefined.has(normalizedTitle)) {
        predefined.set(normalizedTitle, {
          title: service.title.trim(),
          label: serviceOptionLabel(service.title),
          systemImageName: service.system_image_name ?? "sparkles"
        });
      }
    });

    return Array.from(predefined.values()).sort(compareBuildingServiceOptions);
  }, [services]);

  function toggleService(option: BuildingServiceOption, checked: boolean) {
    const normalizedTitle = normalizeChoiceValue(option.title);

    if (checked) {
      if (activeServices.has(normalizedTitle)) {
        return;
      }

      onChange(normalizeBuildingServices([...services, createBuildingServiceDraft(buildingID, option, services.length)]));
      return;
    }

    onChange(normalizeBuildingServices(services.filter((service) => normalizeChoiceValue(service.title) !== normalizedTitle)));
  }

  return (
    <section className="choice-editor">
      <div className="choice-editor-head">
        <div className="form-section-title">Building services</div>
        <span>{services.length} selected</span>
      </div>
      <div className="choice-grid service-choice-grid">
        {options.map((option) => {
          const normalizedTitle = normalizeChoiceValue(option.title);

          return (
            <label className="check-option service-check-option" key={normalizedTitle}>
              <input
                checked={activeServices.has(normalizedTitle)}
                disabled={!canEdit}
                type="checkbox"
                onChange={(event) => toggleService(option, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function UnitDescriptionLabelSelector({
  canEdit,
  value,
  onChange
}: {
  canEdit: boolean;
  value: string[];
  onChange: (labels: string[]) => void;
}) {
  const [customLabel, setCustomLabel] = useState("");
  const labels = useMemo(() => normalizeUnitDescriptionLabels(value), [value]);
  const selectedLabelKeys = useMemo(() => new Set(labels.map(unitDescriptionLabelKey)), [labels]);
  const predefinedLabelKeys = useMemo(
    () => new Set(unitDescriptionLabelOptions.map((option) => unitDescriptionLabelKey(option.value))),
    []
  );
  const customLabels = useMemo(
    () => labels.filter((label) => !predefinedLabelKeys.has(unitDescriptionLabelKey(label))),
    [labels, predefinedLabelKeys]
  );

  function toggleLabel(label: string) {
    onChange(toggleUnitDescriptionLabel(labels, label));
  }

  function addCustomLabel() {
    const nextLabel = normalizeUnitDescriptionLabel(customLabel);

    if (!nextLabel) {
      setCustomLabel("");
      return;
    }

    onChange(normalizeUnitDescriptionLabels([...labels, nextLabel]));
    setCustomLabel("");
  }

  return (
    <div className="description-label-selector">
      <div className="choice-editor-head">
        <div className="form-section-title">Description labels</div>
        <span>{labels.length} selected</span>
      </div>

      {unitDescriptionLabelGroups.map((group) => (
        <div className="description-label-group" key={group.title}>
          <div className="description-label-group-title">{group.title}</div>
          <div className="choice-grid description-label-grid">
            {group.options.map((option) => {
              const optionKey = unitDescriptionLabelKey(option.value);

              return (
                <label className="check-option description-label-option" key={option.value}>
                  <input
                    checked={selectedLabelKeys.has(optionKey)}
                    disabled={!canEdit}
                    type="checkbox"
                    onChange={() => toggleLabel(option.value)}
                  />
                  <span>{option.value}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {customLabels.length > 0 ? (
        <div className="description-label-group">
          <div className="description-label-group-title">Custom</div>
          <div className="choice-grid description-label-grid">
            {customLabels.map((label) => (
              <label className="check-option description-label-option" key={unitDescriptionLabelKey(label)}>
                <input checked disabled={!canEdit} type="checkbox" onChange={() => toggleLabel(label)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="choice-add-row">
        <input
          disabled={!canEdit}
          placeholder="Custom label"
          value={customLabel}
          onChange={(event) => setCustomLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustomLabel();
            }
          }}
        />
        <button className="ghost-button compact-button" disabled={!canEdit || !customLabel.trim()} onClick={addCustomLabel} type="button">
          <Plus size={14} />
          Add
        </button>
      </div>
    </div>
  );
}

function BuildingEditorDialog({
  buildingImages,
  canEdit,
  draft,
  isSaving,
  isUploadingImages,
  managementCompanies,
  neighborhoods,
  services,
  transitLines,
  onImagesChange,
  onUploadImages,
  onServicesChange,
  onTransitLinesChange,
  updateDraft,
  onClose,
  onDelete,
  onSave
}: {
  buildingImages: BuildingImage[];
  canEdit: boolean;
  draft: Building;
  isSaving: boolean;
  isUploadingImages: boolean;
  managementCompanies: ManagementCompany[];
  neighborhoods: Neighborhood[];
  services: BuildingService[];
  transitLines: BuildingTransitLine[];
  onImagesChange: (images: BuildingImage[]) => void;
  onUploadImages: (building: Building, files: File[], kind: BuildingImageKind) => Promise<void> | void;
  onServicesChange: (services: BuildingService[]) => void;
  onTransitLinesChange: (lines: BuildingTransitLine[]) => void;
  updateDraft: <K extends keyof Building>(key: K, value: Building[K]) => void;
  onClose: () => void;
  onDelete: (building: Building) => void;
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
          <div className="drawer-header-actions">
            <button
              className="danger-button compact-button"
              disabled={!canEdit || isSaving || draft.id.startsWith("new-")}
              onClick={() => onDelete(draft)}
              type="button"
            >
              <Trash2 size={15} />
              Delete building
            </button>
            <button className="button compact-button" disabled={!canEdit || isSaving} onClick={onSave} type="button">
              <Save size={15} />
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button className="icon-button" onClick={onClose} title="Close" type="button">
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="drawer-body">
          <BuildingEditor
            canEdit={canEdit}
            draft={draft}
            images={buildingImages}
            isUploadingImages={isUploadingImages}
            managementCompanies={managementCompanies}
            neighborhoods={neighborhoods}
            services={services}
            transitLines={transitLines}
            onImagesChange={onImagesChange}
            onUploadImages={onUploadImages}
            onServicesChange={onServicesChange}
            onTransitLinesChange={onTransitLinesChange}
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
  filteredCount,
  onLoadMore,
  onEditUnit,
  totalCount
}: {
  buildingsByID: Map<string, Building>;
  units: UnitWithListing[];
  filteredCount: number;
  onLoadMore: (event: UIEvent<HTMLDivElement>) => void;
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
        <div className="unit-table-wrap" onScroll={onLoadMore}>
          <div className="unit-table global-unit-table">
            <div className="unit-table-head">
              <span>Unit</span>
              <span>Building</span>
              <span>Layout</span>
              <span>Price</span>
              <span>Deal</span>
              <span>Status</span>
            </div>
            {units.map((unit) => (
              <UnitListingRow
                building={buildingsByID.get(unit.building_id) ?? null}
                key={unit.id}
                onEditUnit={onEditUnit}
                unit={unit}
              />
            ))}
          </div>
          <LoadMoreStatus shown={units.length} total={filteredCount} />
        </div>
      )}
    </section>
  );
}

function BuildingUnitListDialog({
  building,
  canEdit,
  onAddUnit,
  onClose,
  onEditUnit,
  onUpdateUnitPublication,
  publicationUnitID,
  units
}: {
  building: Building;
  canEdit: boolean;
  onAddUnit: (building: Building) => void;
  onClose: () => void;
  onEditUnit: (unit: UnitWithListing) => void;
  onUpdateUnitPublication: (
    unit: UnitWithListing,
    nextStatus: Extract<ListingStatus, "available" | "unavailable">
  ) => Promise<void> | void;
  publicationUnitID: string | null;
  units: UnitWithListing[];
}) {
  const [listFilter, setListFilter] = useState<BuildingUnitListFilter>("listed");
  const listedUnits = units.filter(isListedUnit);
  const unlistedUnits = units.filter((unit) => !isListedUnit(unit));
  const visibleUnits =
    listFilter === "all" ? units : listFilter === "listed" ? listedUnits : unlistedUnits;

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="side-drawer building-units-drawer"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <div className="eyebrow">Unit list</div>
            <h3>{building.name}</h3>
            <p className="drawer-header-subtitle">
              {listedUnits.length} listed / {unlistedUnits.length} unlisted / {units.length} total
            </p>
          </div>
          <div className="drawer-header-actions">
            <button className="button compact-button" disabled={!canEdit} onClick={() => onAddUnit(building)} type="button">
              <Plus size={15} />
              Add unit
            </button>
            <button className="icon-button" onClick={onClose} title="Close" type="button">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="drawer-body">
          {units.length === 0 ? (
            <EmptyState title="No units yet" body="Add the first unit for this building." />
          ) : (
            <>
              <div className="building-unit-filter">
                <span>Show</span>
                <div className="building-unit-filter-tabs">
                  {(["listed", "unlisted", "all"] as BuildingUnitListFilter[]).map((filter) => (
                    <button
                      className={listFilter === filter ? "active" : ""}
                      key={filter}
                      onClick={() => setListFilter(filter)}
                      type="button"
                    >
                      {buildingUnitFilterLabel(filter)}
                    </button>
                  ))}
                </div>
                <strong>{visibleUnits.length} shown</strong>
              </div>

              {visibleUnits.length === 0 ? (
                <EmptyState
                  title={`No ${buildingUnitFilterLabel(listFilter).toLowerCase()} units`}
                  body="Change the filter or add a new unit."
                />
              ) : (
                <div className="building-unit-list">
                  <div className="building-unit-list-head">
                    <span>Unit</span>
                    <span>Layout</span>
                    <span>Price</span>
                    <span>Status</span>
                    <span>Actions</span>
                  </div>
                  {visibleUnits.map((unit) => (
                    <BuildingUnitListRow
                      canEdit={canEdit}
                      isUpdatingPublication={publicationUnitID === unit.id}
                      key={unit.id}
                      onEditUnit={onEditUnit}
                      onUpdateUnitPublication={onUpdateUnitPublication}
                      unit={unit}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function BuildingUnitListRow({
  canEdit,
  isUpdatingPublication,
  onEditUnit,
  onUpdateUnitPublication,
  unit
}: {
  canEdit: boolean;
  isUpdatingPublication: boolean;
  onEditUnit: (unit: UnitWithListing) => void;
  onUpdateUnitPublication: (
    unit: UnitWithListing,
    nextStatus: Extract<ListingStatus, "available" | "unavailable">
  ) => Promise<void> | void;
  unit: UnitWithListing;
}) {
  const listing = unitListListing(unit);
  const isListed = isListedUnit(unit);
  const nextStatus = isListed ? "unavailable" : "available";

  return (
    <div
      className="building-unit-row clickable-row"
      onClick={() => onEditUnit(unit)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEditUnit(unit);
        }
      }}
      tabIndex={0}
    >
      <div className="building-unit-identity">
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
        <span>{unit.name || "Untitled unit"}</span>
      </div>
      <div className="building-unit-meta">
        <strong>{unitLayoutLabel(unit)}</strong>
        <span>{unit.sqft ? `${unit.sqft.toLocaleString()} sqft` : "Sqft not set"}</span>
      </div>
      <div className="building-unit-meta">
        <strong>{formatMoneyFromCents(listing.net_price_cents)}</strong>
        <span>{leaseDealLabel(listing.lease_months, listing.free_months) || "No deal"}</span>
      </div>
      <div>
        <span className={`status-pill ${listing.status === "available" ? "active" : "suspended"}`}>{listing.status}</span>
      </div>
      <div className="row-actions building-unit-actions">
        <button
          className={`mini-action ${isListed ? "danger-ghost-button" : ""}`}
          disabled={!canEdit || isUpdatingPublication}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateUnitPublication(unit, nextStatus);
          }}
          type="button"
        >
          {isListed ? <EyeOff size={13} /> : <UploadCloud size={13} />}
          {isUpdatingPublication ? "Saving" : isListed ? "Unlist" : "Publish"}
        </button>
      </div>
    </div>
  );
}

function UnitListingRow({
  building,
  unit,
  onEditUnit
}: {
  building: Building | null;
  unit: UnitWithListing;
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
        <strong>{leaseDealLabel(listing.lease_months, listing.free_months) || "No deal"}</strong>
        <span>{listing.available_from ? `Move in ${formatDate(listing.available_from)}` : "Move-in not set"}</span>
      </div>
      <div className="unit-cell">
        <span className={`status-pill ${listing.status === "available" ? "active" : "suspended"}`}>
          {listing.status}
        </span>
      </div>
    </div>
  );
}

function UnitEditorDialog({
  building,
  unit,
  canEdit,
  images,
  onClose,
  onSaved
}: {
  building: Building | null;
  unit: UnitWithListing;
  canEdit: boolean;
  images: UnitImage[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(unit);
  const [imageDrafts, setImageDrafts] = useState<UnitImage[]>(images);
  const [leaseMonths, setLeaseMonths] = useState(() => leaseMonthsFromListing(unit.listing ?? defaultListing(unit.id)));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(unit);
    setImageDrafts(images);
    setLeaseMonths(leaseMonthsFromListing(unit.listing ?? defaultListing(unit.id)));
    setError(null);
  }, [images, unit]);

  function updateListingDraft(patch: Partial<UnitListing>, nextLeaseMonths = leaseMonths) {
    setDraft((current) => {
      const nextListing = applyConcessionPricing(
        {
          ...defaultListing(current.id),
          ...current.listing,
          ...patch,
          lease_months: nextLeaseMonths
        },
        nextLeaseMonths
      );

      return {
        ...current,
        listing: nextListing
      };
    });
  }

  function updateListing<K extends keyof UnitListing>(key: K, value: UnitListing[K]) {
    updateListingDraft({ [key]: value } as Pick<UnitListing, K>);
  }

  function updateLeaseMonths(nextLeaseMonths: number) {
    setLeaseMonths(nextLeaseMonths);
    updateListingDraft({}, nextLeaseMonths);
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

    const descriptionLabels = normalizeUnitDescriptionLabels(nextDraft.description_labels);
    const unitPayload = {
      building_id: buildingID,
      unit_number: nextDraft.unit_number,
      name: nextDraft.name || `Unit ${nextDraft.unit_number}`,
      description: nextDraft.description,
      bedroom_count: nextDraft.bedroom_count,
      bathroom_count: nextDraft.bathroom_count,
      sqft: nextDraft.sqft,
      floor: nextDraft.floor,
      description_labels: descriptionLabels,
      application_url: normalizeApplicationURL(nextDraft.application_url)
    };

    if (!unitPayload.application_url) {
      setError("Unit application URL is required.");
      setIsSaving(false);
      return;
    }

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
            description_labels: unitPayload.description_labels,
            application_url: unitPayload.application_url
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
    const listing = nextDraft.listing
      ? applyConcessionPricing(
          {
            ...defaultListing(savedUnit.id),
            ...nextDraft.listing,
            unit_id: savedUnit.id
          },
          leaseMonths
        )
      : null;

    if (listing) {
      const listingPayload = {
        unit_id: savedUnit.id,
        status: listing.status,
        market_price_cents: listing.market_price_cents,
        lease_months: listing.lease_months,
        net_price_cents: listing.net_price_cents,
        free_months: listing.free_months,
        cash_back_cents: listing.cash_back_cents,
        final_price_cents: listing.final_price_cents,
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

    try {
      await syncUnitImages(savedUnit.id, imageDrafts);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Unit saved, but images could not be saved.");
      setIsSaving(false);
      return;
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

  const listing = applyConcessionPricing(draft.listing ?? defaultListing(draft.id), leaseMonths);
  const totalTermMonths = leaseMonths + listing.free_months;

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
              <InputField
                className="field full"
                disabled={!canEdit}
                label="Unit application URL"
                placeholder="https://leasing-office.com/apply/unit"
                required
                type="url"
                value={draft.application_url ?? ""}
                onChange={(value) => setDraft((current) => ({ ...current, application_url: value }))}
              />
              <NumberField
                disabled={!canEdit}
                label="Floor"
                value={draft.floor}
                onChange={(value) => setDraft((current) => ({ ...current, floor: value == null ? null : Math.round(value) }))}
              />
              <UnitDescriptionLabelSelector
                canEdit={canEdit}
                value={draft.description_labels}
                onChange={(labels) => setDraft((current) => ({ ...current, description_labels: labels }))}
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
            <ImageCollectionEditor
              canEdit={canEdit}
              createImage={() => createUnitImageDraft(draft.id, imageDrafts.length)}
              helpText="Unit photos should describe the rooms first. Use floor_plan only for the floor plan image."
              images={imageDrafts}
              kinds={unitImageKinds}
              onChange={setImageDrafts}
              title="Unit media"
            />
          </section>

          <section className="unit-editor-card">
            <div className="form-section-title">Price</div>
            <div className="form-grid dense">
              <CentsInput
                disabled={!canEdit}
                label="Market"
                value={listing.market_price_cents}
                onChange={(value) => updateListing("market_price_cents", value)}
              />
              <CentsInput
                disabled={!canEdit}
                label="Cashback"
                value={listing.cash_back_cents}
                onChange={(value) => updateListing("cash_back_cents", value ?? 0)}
              />
              <ReadonlyMoneyField label="Net price" value={listing.net_price_cents} />
              <ReadonlyMoneyField label="Final price" value={listing.final_price_cents} />
            </div>
          </section>

          <section className="unit-editor-card">
            <div className="form-section-title">Deal and status</div>
            <div className="form-grid dense">
              <MonthSelect
                disabled={!canEdit}
                label="Lease months"
                options={leaseMonthOptions}
                value={leaseMonths}
                onChange={updateLeaseMonths}
              />
              <MonthSelect
                disabled={!canEdit}
                label="Free months"
                options={freeMonthOptions}
                value={listing.free_months}
                onChange={(value) => updateListing("free_months", value)}
              />
              <ReadonlyTextField label="Lease deal" value={leaseDealLabel(leaseMonths, listing.free_months) || "No deal"} />
              <ReadonlyTextField label="Term" value={`${formatMonthValue(totalTermMonths)} months total`} />
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

type ImageRowBase = {
  id: string;
  kind: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
};

function BuildingImageUploader({
  building,
  canEdit,
  isUploading,
  onUpload
}: {
  building: Building;
  canEdit: boolean;
  isUploading: boolean;
  onUpload: (building: Building, files: File[], kind: BuildingImageKind) => Promise<void> | void;
}) {
  const [kind, setKind] = useState<BuildingImageKind>("gallery");
  const [isDragging, setIsDragging] = useState(false);
  const isNewBuilding = building.id.startsWith("new-");
  const isDisabled = !canEdit || isUploading || isNewBuilding;
  const dropzoneClassName = [
    "image-upload-dropzone",
    isDragging ? "dragging" : "",
    isDisabled ? "disabled" : ""
  ]
    .filter(Boolean)
    .join(" ");

  function uploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);

    if (files.length === 0 || isDisabled) {
      return;
    }

    void onUpload(building, files, kind);
  }

  return (
    <section className="image-upload-panel">
      <div className="image-upload-head">
        <div>
          <div className="form-section-title">Upload building images</div>
          <p>Drag files from the local building folder, choose one category, and upload directly to storage.</p>
        </div>
        <label className="field image-upload-kind">
          <span>Category</span>
          <select disabled={isDisabled} value={kind} onChange={(event) => setKind(event.target.value as BuildingImageKind)}>
            {buildingImageKinds.map((option) => (
              <option key={option} value={option}>
                {imageKindLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label
        className={dropzoneClassName}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!isDisabled) {
            setIsDragging(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          uploadFiles(event.dataTransfer.files);
        }}
      >
        <input
          accept={acceptedBuildingImageTypes.join(",")}
          disabled={isDisabled}
          multiple
          type="file"
          onChange={(event) => {
            uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <UploadCloud size={22} />
        <strong>{isUploading ? "Uploading..." : "Drop images here or click to browse"}</strong>
        <span>
          {isNewBuilding
            ? "Save this building before uploading images."
            : "JPG, PNG, WebP, or GIF. Uploaded images are added to the media list below."}
        </span>
      </label>
    </section>
  );
}

function ImageCollectionEditor<TImage extends ImageRowBase>({
  canEdit,
  createImage,
  helpText,
  images,
  kinds,
  onChange,
  title
}: {
  canEdit: boolean;
  createImage: () => TImage;
  helpText: string;
  images: TImage[];
  kinds: readonly string[];
  onChange: (images: TImage[]) => void;
  title: string;
}) {
  const sortedImages = useMemo(() => images.slice().sort(compareMediaImageRows), [images]);
  const kindOptions = useMemo(
    () => Array.from(new Set([...kinds, ...images.map((image) => image.kind)])),
    [images, kinds]
  );

  function updateImage(imageID: string, patch: Partial<TImage>) {
    onChange(images.map((image) => (image.id === imageID ? { ...image, ...patch } : image)));
  }

  function removeImage(imageID: string) {
    onChange(normalizeMediaSort(images.filter((image) => image.id !== imageID)));
  }

  function addImage() {
    onChange(normalizeMediaSort([...sortedImages, createImage()]));
  }

  function moveImage(imageID: string, direction: -1 | 1) {
    const currentIndex = sortedImages.findIndex((image) => image.id === imageID);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sortedImages.length) {
      return;
    }

    const reorderedImages = sortedImages.slice();
    const [movedImage] = reorderedImages.splice(currentIndex, 1);

    reorderedImages.splice(nextIndex, 0, movedImage);
    onChange(normalizeMediaSort(reorderedImages));
  }

  return (
    <section className="media-editor">
      <div className="media-editor-head">
        <div>
          <div className="form-section-title">{title}</div>
          <p>{helpText}</p>
        </div>
        <button className="ghost-button compact-button" disabled={!canEdit} onClick={addImage} type="button">
          <Plus size={14} />
          Add image
        </button>
      </div>

      {sortedImages.length === 0 ? (
        <div className="media-empty">No images yet.</div>
      ) : (
        <div className="media-list">
          {sortedImages.map((image, index) => (
            <div className="media-row" key={image.id}>
              <div className="media-thumb">
                {image.url.trim() ? (
                  <span
                    aria-hidden="true"
                    className="media-thumb-image"
                    style={{ backgroundImage: `url(${JSON.stringify(image.url)})` }}
                  />
                ) : (
                  <ImageIcon aria-hidden="true" size={18} />
                )}
              </div>
              <div className="media-row-fields">
                <label className="field">
                  <span>Type</span>
                  <select
                    disabled={!canEdit}
                    value={image.kind}
                    onChange={(event) => updateImage(image.id, { kind: event.target.value } as Partial<TImage>)}
                  >
                    {kindOptions.map((kind) => (
                      <option key={kind} value={kind}>
                        {imageKindLabel(kind)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field media-url-field">
                  <span>Image URL</span>
                  <input
                    disabled={!canEdit}
                    value={image.url}
                    onChange={(event) => updateImage(image.id, { url: event.target.value } as Partial<TImage>)}
                  />
                </label>
                <label className="field">
                  <span>Alt text</span>
                  <input
                    disabled={!canEdit}
                    value={image.alt_text ?? ""}
                    onChange={(event) => updateImage(image.id, { alt_text: event.target.value || null } as Partial<TImage>)}
                  />
                </label>
                <label className="field">
                  <span>Sort</span>
                  <input
                    disabled={!canEdit}
                    type="number"
                    value={image.sort_order}
                    onChange={(event) =>
                      updateImage(image.id, { sort_order: Number(event.target.value) || 0 } as Partial<TImage>)
                    }
                  />
                </label>
              </div>
              <div className="media-actions">
                <button
                  className="icon-button"
                  disabled={!canEdit || index === 0}
                  onClick={() => moveImage(image.id, -1)}
                  title="Move up"
                  type="button"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button"
                  disabled={!canEdit || index === sortedImages.length - 1}
                  onClick={() => moveImage(image.id, 1)}
                  title="Move down"
                  type="button"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className="icon-button danger"
                  disabled={!canEdit}
                  onClick={() => removeImage(image.id)}
                  title="Remove"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InputField({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  className = "field",
  placeholder,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className={className}>
      <span>{label}</span>
      <input
        disabled={disabled}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  step = "1",
  min,
  max
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  step?: string;
  min?: number;
  max?: number;
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

function MonthSelect({
  label,
  value,
  options,
  onChange,
  disabled
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const optionSet = new Set([...options, value]);
  const normalizedOptions = Array.from(optionSet).sort((first, second) => first - second);

  return (
    <label className="field">
      <span>{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {normalizedOptions.map((option) => (
          <option key={option} value={option}>
            {formatMonthValue(option)} mo
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadonlyMoneyField({ label, value }: { label: string; value: number | null }) {
  return <ReadonlyTextField label={label} value={formatMoneyFromCents(value)} />;
}

function ReadonlyTextField({ label, value }: { label: string; value: string }) {
  return (
    <label className="field readonly-field">
      <span>{label}</span>
      <output>{value}</output>
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

function buildingAreaLabel(building: Building) {
  return building.area || building.neighborhoods?.name || building.city || "Other";
}

function buildingListAreaTitle(building: Building) {
  if (building.area && building.area !== building.city) {
    return building.area;
  }

  if (building.neighborhoods?.name && building.neighborhoods.name !== building.city) {
    return building.neighborhoods.name;
  }

  return "No area";
}

function buildingCompanyName(building: Building) {
  return building.management_companies?.name ?? building.management_company ?? "Unassigned";
}

function buildingCompanyFilterValue(building: Building) {
  if (building.management_company_id) {
    return `company:${building.management_company_id}`;
  }

  const legacyName = building.management_company?.trim();

  if (legacyName) {
    return `legacy:${legacyName.toLowerCase()}`;
  }

  return "none";
}

function areaColor(area: string, fallbackIndex: number) {
  const preferredIndex = preferredMapAreas.indexOf(area);

  if (preferredIndex !== -1) {
    return mapAreaPalette[preferredIndex % mapAreaPalette.length];
  }

  return mapAreaPalette[fallbackIndex % mapAreaPalette.length];
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

function createBuildingImageDraft(buildingID: string, index: number): BuildingImage {
  const now = new Date().toISOString();

  return {
    id: `new-building-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    building_id: buildingID,
    kind: "gallery",
    url: "",
    alt_text: null,
    sort_order: index * 10,
    created_at: now
  };
}

function createBuildingCoverImageDraft(buildingID: string, url: string): BuildingImage {
  return {
    id: `new-building-cover-${buildingID}`,
    building_id: buildingID,
    kind: "cover",
    url,
    alt_text: null,
    sort_order: -10,
    created_at: ""
  };
}

function createBuildingServiceDraft(buildingID: string, option: BuildingServiceOption, index: number): BuildingService {
  const now = new Date().toISOString();

  return {
    id: `new-building-service-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    building_id: buildingID,
    title: option.title.trim().toUpperCase(),
    system_image_name: option.systemImageName,
    sort_order: index,
    created_at: now
  };
}

function createBuildingTransitLineDraft(buildingID: string, lineName: string, index: number): BuildingTransitLine {
  const now = new Date().toISOString();

  return {
    id: `new-building-transit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    building_id: buildingID,
    line_name: lineName.trim(),
    station_name: null,
    walk_minutes: null,
    distance_miles: null,
    sort_order: index,
    created_at: now
  };
}

function createUnitImageDraft(unitID: string, index: number): UnitImage {
  const now = new Date().toISOString();

  return {
    id: `new-unit-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    unit_id: unitID,
    kind: "photo",
    url: "",
    alt_text: null,
    sort_order: index * 10,
    created_at: now
  };
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
    application_url: null,
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
    lease_months: 12,
    free_months: 0,
    cash_back_cents: 0,
    final_price_cents: null,
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

function leaseMonthsFromListing(listing: UnitListing) {
  if (Number.isFinite(listing.lease_months)) {
    return Math.min(24, Math.max(10, listing.lease_months));
  }

  return 12;
}

function applyConcessionPricing(listing: UnitListing, leaseMonths: number): UnitListing {
  return {
    ...listing,
    lease_months: leaseMonths,
    net_price_cents: calculateNetPriceCents(listing.market_price_cents, leaseMonths, listing.free_months),
    final_price_cents: calculateFinalPriceCents(
      listing.market_price_cents,
      leaseMonths,
      listing.free_months,
      listing.cash_back_cents
    )
  };
}

function leaseDealLabel(leaseMonths: number, freeMonths: number) {
  if (freeMonths <= 0) {
    return "";
  }

  return `${formatMonthValue(leaseMonths)}MO + ${formatMonthValue(freeMonths)}MO FREE`;
}

function unitLayoutLabel(unit: UnitWithListing) {
  return `${unit.bedroom_count} bd / ${unit.bathroom_count} ba`;
}

function isListedUnit(unit: UnitWithListing) {
  return unit.listing?.status === "available";
}

function unitListListing(unit: UnitWithListing) {
  return unit.listing ?? { ...defaultListing(unit.id), status: "unavailable" as ListingStatus };
}

function buildingUnitFilterLabel(filter: BuildingUnitListFilter) {
  if (filter === "all") {
    return "All";
  }

  return filter === "listed" ? "Listed" : "Unlisted";
}

function calculateNetPriceCents(marketPriceCents: number | null, leaseMonths: number, freeMonths: number) {
  if (!marketPriceCents || marketPriceCents <= 0) {
    return 0;
  }

  const totalTermMonths = Math.max(1, leaseMonths + freeMonths);
  return Math.round((marketPriceCents * leaseMonths) / totalTermMonths);
}

function calculateFinalPriceCents(
  marketPriceCents: number | null,
  leaseMonths: number,
  freeMonths: number,
  cashBackCents: number
) {
  if (!marketPriceCents || marketPriceCents <= 0) {
    return null;
  }

  const totalTermMonths = Math.max(1, leaseMonths + freeMonths);
  return Math.max(0, Math.round((marketPriceCents * leaseMonths - cashBackCents) / totalTermMonths));
}

function formatMonthValue(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/, "");
}

function buildingPayload(building: Building, images: BuildingImage[]) {
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
    convenience_score: scoreInputValue(building.convenience_score, 70),
    activity_score: scoreInputValue(building.activity_score, 50),
    summary: building.summary,
    description_labels: normalizeBuildingDescriptionLabels(building.description_labels),
    cover_image_url: coverImageURLFromImages(images),
    is_active: building.is_active,
    year_built: building.year_built,
    total_floors: building.total_floors,
    total_units: building.total_units,
    management_company_id: building.management_company_id,
    management_company: building.management_company,
    website: building.website,
    area: building.area
  };
}

function scoreInputValue(value: number | null, fallback: number) {
  const numericValue = value == null || Number.isNaN(value) ? fallback : value;
  return Math.max(0, Math.min(100, numericValue));
}

async function syncBuildingImages(buildingID: string, images: BuildingImage[]) {
  const desiredImages = normalizedPersistableImages(images);
  const { data: currentRows, error: currentError } = await supabase
    .from("building_images")
    .select("*")
    .eq("building_id", buildingID);

  if (currentError) {
    throw new Error(currentError.message);
  }

  const existingIDs = new Set(((currentRows ?? []) as BuildingImage[]).map((image) => image.id));
  const desiredExistingIDs = new Set(
    desiredImages.filter((image) => !isTemporaryID(image.id) && existingIDs.has(image.id)).map((image) => image.id)
  );
  const deletedIDs = Array.from(existingIDs).filter((id) => !desiredExistingIDs.has(id));

  if (deletedIDs.length > 0) {
    const { error: deleteError } = await supabase.from("building_images").delete().in("id", deletedIDs);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  for (const image of desiredImages) {
    const payload = {
      building_id: buildingID,
      kind: image.kind as BuildingImageKind,
      url: image.url,
      alt_text: image.alt_text,
      sort_order: image.sort_order
    };
    const result =
      isTemporaryID(image.id) || !existingIDs.has(image.id)
        ? await supabase.from("building_images").insert(payload)
        : await supabase.from("building_images").update(payload).eq("id", image.id);

    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const { data: nextRows, error: nextError } = await supabase
    .from("building_images")
    .select("*")
    .eq("building_id", buildingID)
    .order("sort_order", { ascending: true });

  if (nextError) {
    throw new Error(nextError.message);
  }

  return (nextRows ?? []) as BuildingImage[];
}

async function syncBuildingServices(buildingID: string, services: BuildingService[]) {
  const desiredServices = normalizeBuildingServices(services);
  const { error: deleteError } = await supabase.from("building_services").delete().eq("building_id", buildingID);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (desiredServices.length > 0) {
    const { error: insertError } = await supabase.from("building_services").insert(
      desiredServices.map((service) => ({
        building_id: buildingID,
        title: service.title,
        system_image_name: service.system_image_name,
        sort_order: service.sort_order
      }))
    );

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const { data: nextRows, error: nextError } = await supabase
    .from("building_services")
    .select("*")
    .eq("building_id", buildingID)
    .order("sort_order", { ascending: true });

  if (nextError) {
    throw new Error(nextError.message);
  }

  return (nextRows ?? []) as BuildingService[];
}

async function syncBuildingTransitLines(buildingID: string, lines: BuildingTransitLine[]) {
  const desiredLines = normalizeBuildingTransitLines(lines);
  const { error: deleteError } = await supabase.from("building_transit_lines").delete().eq("building_id", buildingID);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (desiredLines.length > 0) {
    const { error: insertError } = await supabase.from("building_transit_lines").insert(
      desiredLines.map((line) => ({
        building_id: buildingID,
        line_name: line.line_name,
        station_name: normalizeOptionalText(line.station_name),
        walk_minutes: line.walk_minutes,
        distance_miles: line.distance_miles,
        sort_order: line.sort_order
      }))
    );

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  const { data: nextRows, error: nextError } = await supabase
    .from("building_transit_lines")
    .select("*")
    .eq("building_id", buildingID)
    .order("sort_order", { ascending: true });

  if (nextError) {
    throw new Error(nextError.message);
  }

  return (nextRows ?? []) as BuildingTransitLine[];
}

async function syncUnitImages(unitID: string, images: UnitImage[]) {
  const desiredImages = normalizedPersistableImages(images);
  const { data: currentRows, error: currentError } = await supabase.from("unit_images").select("*").eq("unit_id", unitID);

  if (currentError) {
    throw new Error(currentError.message);
  }

  const existingIDs = new Set(((currentRows ?? []) as UnitImage[]).map((image) => image.id));
  const desiredExistingIDs = new Set(
    desiredImages.filter((image) => !isTemporaryID(image.id) && existingIDs.has(image.id)).map((image) => image.id)
  );
  const deletedIDs = Array.from(existingIDs).filter((id) => !desiredExistingIDs.has(id));

  if (deletedIDs.length > 0) {
    const { error: deleteError } = await supabase.from("unit_images").delete().in("id", deletedIDs);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  for (const image of desiredImages) {
    const payload = {
      unit_id: unitID,
      kind: image.kind as UnitImageKind,
      url: image.url,
      alt_text: image.alt_text,
      sort_order: image.sort_order
    };
    const result =
      isTemporaryID(image.id) || !existingIDs.has(image.id)
        ? await supabase.from("unit_images").insert(payload)
        : await supabase.from("unit_images").update(payload).eq("id", image.id);

    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const { data: nextRows, error: nextError } = await supabase
    .from("unit_images")
    .select("*")
    .eq("unit_id", unitID)
    .order("sort_order", { ascending: true });

  if (nextError) {
    throw new Error(nextError.message);
  }

  return (nextRows ?? []) as UnitImage[];
}

function normalizedPersistableImages<TImage extends ImageRowBase>(images: TImage[]) {
  return normalizeMediaSort(images)
    .map((image) => ({
      ...image,
      url: image.url.trim(),
      alt_text: normalizeOptionalText(image.alt_text)
    }))
    .filter((image) => image.url.length > 0);
}

function buildingImagesWithCoverFallback(building: Building, images: BuildingImage[]) {
  const coverImageURL = normalizeOptionalText(building.cover_image_url);

  if (!coverImageURL) {
    return images;
  }

  const hasPersistableCover = images.some((image) => image.kind === "cover" && image.url.trim().length > 0);

  if (hasPersistableCover) {
    return images;
  }

  return [createBuildingCoverImageDraft(building.id, coverImageURL), ...images];
}

function coverImageURLFromImages(images: ImageRowBase[]) {
  return normalizeOptionalText(
    images
      .slice()
      .sort(compareMediaImageRows)
      .find((image) => image.kind === "cover" && image.url.trim().length > 0)
      ?.url ?? null
  );
}

function nextMediaSortOrder(images: ImageRowBase[]) {
  const maxSortOrder = images.reduce((maxValue, image) => Math.max(maxValue, image.sort_order), -10);

  return maxSortOrder + 10;
}

function firstMediaSortOrder(images: ImageRowBase[]) {
  return images.reduce((minValue, image) => Math.min(minValue, image.sort_order), 0);
}

function buildingMediaObjectPath(building: Building, file: File) {
  const buildingFolder = slugify(`${building.name}-${building.id.slice(0, 8)}`) || building.id;
  const baseName = slugify(file.name.replace(/\.[^.]+$/, "")) || "image";
  const uniqueID =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${buildingFolder}/${Date.now()}-${uniqueID}-${baseName}.${imageFileExtension(file)}`;
}

function imageFileExtension(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension && ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) {
    return extension === "jpeg" ? "jpg" : extension;
  }

  if (file.type === "image/png") {
    return "png";
  }

  if (file.type === "image/webp") {
    return "webp";
  }

  if (file.type === "image/gif") {
    return "gif";
  }

  return "jpg";
}

function normalizeBuildingServices(services: BuildingService[]) {
  const serviceByTitle = new Map<string, BuildingService>();

  services.forEach((service) => {
    const title = service.title.trim().toUpperCase();

    if (!title) {
      return;
    }

    serviceByTitle.set(normalizeChoiceValue(title), {
      ...service,
      title,
      system_image_name: normalizeOptionalText(service.system_image_name) ?? fallbackServiceIcon(title)
    });
  });

  return Array.from(serviceByTitle.values())
    .sort((first, second) => compareChoiceOrder(first.title, second.title, buildingServiceOptions.map((option) => option.title)))
    .map((service, index) => ({ ...service, sort_order: index }));
}

function normalizeBuildingTransitLines(lines: BuildingTransitLine[]) {
  const lineByName = new Map<string, BuildingTransitLine>();

  lines.forEach((line) => {
    const lineName = line.line_name.trim();

    if (!lineName) {
      return;
    }

    lineByName.set(normalizeChoiceValue(lineName), {
      ...line,
      line_name: lineName,
      station_name: normalizeOptionalText(line.station_name)
    });
  });

  return Array.from(lineByName.values())
    .sort((first, second) => compareChoiceOrder(first.line_name, second.line_name, transitLineOptions))
    .map((line, index) => ({ ...line, sort_order: index }));
}

function normalizeMediaSort<TImage extends ImageRowBase>(images: TImage[]) {
  return images.slice().sort(compareMediaImageRows).map((image, index) => ({ ...image, sort_order: index * 10 }));
}

function compareMediaImageRows(first: ImageRowBase, second: ImageRowBase) {
  return first.sort_order - second.sort_order || first.created_at.localeCompare(second.created_at) || first.id.localeCompare(second.id);
}

function compareSortableRows(first: { sort_order: number; created_at: string; id: string }, second: { sort_order: number; created_at: string; id: string }) {
  return first.sort_order - second.sort_order || first.created_at.localeCompare(second.created_at) || first.id.localeCompare(second.id);
}

function normalizeOptionalText(value: string | null) {
  const trimmedValue = value?.trim() ?? "";

  return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeApplicationURL(value: string | null) {
  const trimmedValue = normalizeOptionalText(value);

  if (!trimmedValue) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function normalizeChoiceValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function compareChoiceOrder(first: string, second: string, preferredOrder: string[]) {
  const preferred = new Map(preferredOrder.map((value, index) => [normalizeChoiceValue(value), index]));
  const firstIndex = preferred.get(normalizeChoiceValue(first)) ?? 999;
  const secondIndex = preferred.get(normalizeChoiceValue(second)) ?? 999;

  if (firstIndex !== secondIndex) {
    return firstIndex - secondIndex;
  }

  return first.localeCompare(second);
}

function compareBuildingServiceOptions(first: BuildingServiceOption, second: BuildingServiceOption) {
  return compareChoiceOrder(first.title, second.title, buildingServiceOptions.map((option) => option.title));
}

function serviceOptionLabel(title: string) {
  return title
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackServiceIcon(title: string) {
  return buildingServiceOptions.find((option) => normalizeChoiceValue(option.title) === normalizeChoiceValue(title))?.systemImageName ?? "sparkles";
}

function isTemporaryID(id: string) {
  return id.startsWith("new-");
}

function imageKindLabel(kind: string) {
  return kind
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
