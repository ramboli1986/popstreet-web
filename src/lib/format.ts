import type { AdminRole, AccountStatus } from "./types";

export function formatMoneyFromCents(value: number | null | undefined) {
  if (value == null) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value / 100);
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function toStringArray(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function stringArrayToInput(value: string[] | null | undefined) {
  return (value ?? []).join(", ");
}

export function roleLabel(role: AdminRole) {
  const labels: Record<AdminRole, string> = {
    super_admin: "Super admin",
    admin: "Admin",
    editor: "Editor",
    viewer: "Viewer"
  };

  return labels[role];
}

export function statusLabel(status: AccountStatus) {
  const labels: Record<AccountStatus, string> = {
    active: "Active",
    pending: "Pending",
    suspended: "Suspended"
  };

  return labels[status];
}

export function canEditInventory(role: AdminRole | null | undefined) {
  return role === "super_admin" || role === "admin" || role === "editor";
}

export function canManageAccounts(role: AdminRole | null | undefined) {
  return role === "super_admin" || role === "admin";
}
