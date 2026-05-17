export type AdminRole = "super_admin" | "admin" | "editor" | "viewer";
export type AccountStatus = "active" | "pending" | "suspended";
export type AccountKind = "admin" | "mobile";
export type ListingStatus = "available" | "unavailable" | "pending" | "rented" | "archived";

export type AccountProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AdminRole;
  status: AccountStatus;
  account_kind?: AccountKind | null;
  is_mobile_user?: boolean | null;
  oauth_provider: "apple" | "google" | null;
  oauth_subject: string | null;
  email_confirmed_at?: string | null;
  display_name: string | null;
  phone: string | null;
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

export type ManagementCompany = {
  id: string;
  slug: string;
  name: string;
  website: string | null;
  key_assets: string[];
  unit_count_label: string | null;
  estimated_unit_count: number | null;
  notes: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
};

export type TourDataSource = "manual" | "scraped_pending" | "scraped_verified";

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
  management_company_id: string | null;
  management_company: string | null;
  website: string | null;
  area: string | null;
  leasing_email: string | null;
  leasing_phone: string | null;
  leasing_contact_name: string | null;
  tour_booking_url: string | null;
  application_url: string | null;
  application_fee_cents: number | null;
  tour_schedule_notes: string | null;
  tour_data_source: TourDataSource;
  created_at: string;
  updated_at: string;
  neighborhoods?: Pick<Neighborhood, "name" | "slug"> | null;
  management_companies?: Pick<ManagementCompany, "id" | "slug" | "name" | "website"> | null;
};

export type TourRequestStatus =
  | "submitted"
  | "link_provided"
  | "ops_review"
  | "leasing_contacted"
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no_response";

export type TourType = "in_person" | "virtual" | "self_guided";

export type TourRequest = {
  id: string;
  user_id: string;
  building_id: string;
  unit_id: string | null;
  listing_id: string | null;
  preferred_dates: string[];
  preferred_time_of_day: "morning" | "afternoon" | "evening" | "flexible" | null;
  tour_type: TourType;
  status: TourRequestStatus;
  notes: string | null;
  external_link_used: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationStatus =
  | "submitted"
  | "ops_in_progress"
  | "link_ready"
  | "submitted_to_lo"
  | "under_review"
  | "accepted"
  | "rejected"
  | "cashback_pending"
  | "cashback_paid"
  | "cancelled"
  | "no_response";

export type Application = {
  id: string;
  user_id: string;
  building_id: string;
  unit_id: string | null;
  listing_id: string | null;
  status: ApplicationStatus;
  notes: string | null;
  fee_cents: number | null;
  broker_link: string | null;
  broker_link_sent_at: string | null;
  submitted_to_lo_at: string | null;
  accepted_at: string | null;
  cashback_amount_cents: number | null;
  cashback_paid_at: string | null;
  created_at: string;
  updated_at: string;
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
  lease_months: number;
  free_months: number;
  cash_back_cents: number;
  final_price_cents: number | null;
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
