export type AdminRole = "super_admin" | "admin" | "editor" | "viewer";
export type AccountStatus = "active" | "pending" | "suspended";
export type ListingStatus = "available" | "unavailable" | "pending" | "rented" | "archived";

export type AccountProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AdminRole;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
};

export type Neighborhood = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
};

export type Building = {
  id: string;
  slug: string;
  name: string;
  address: string;
  full_address: string;
  neighborhood_id: string | null;
  city: string;
  state: string;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  score: number | null;
  summary: string | null;
  description_labels: string[];
  cover_image_url: string | null;
  story_video_url: string | null;
  is_active: boolean;
  year_built: number | null;
  total_floors: number | null;
  total_units: number | null;
  management_company: string | null;
  website: string | null;
  area: string | null;
  created_at: string;
  updated_at: string;
  neighborhoods?: Pick<Neighborhood, "name" | "slug"> | null;
};

export type Unit = {
  id: string;
  building_id: string;
  unit_number: string;
  name: string;
  description: string | null;
  bedroom_count: number;
  bathroom_count: number;
  sqft: number | null;
  floor: number | null;
  description_labels: string[];
  created_at: string;
  updated_at: string;
};

export type UnitListing = {
  id: string;
  unit_id: string;
  status: ListingStatus;
  market_price_cents: number | null;
  net_price_cents: number;
  lease_deal: string | null;
  free_months: number;
  cash_back_cents: number;
  available_from: string | null;
  listed_at: string;
  last_seen_at: string;
  unavailable_at: string | null;
  source: string;
  source_listing_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UnitWithListing = Unit & {
  listing?: UnitListing | null;
};

export type BuildingStats = {
  totalBuildings: number;
  activeBuildings: number;
  totalUnits: number;
  availableListings: number;
  minNetPrice: number | null;
};

export type InventoryRole = Extract<AdminRole, "super_admin" | "admin" | "editor">;
