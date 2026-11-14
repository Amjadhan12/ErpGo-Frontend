import axios from "axios";
import { api } from "@/lib/api";

export interface InventoryWarehouseOption {
  id: number;
  name: string;
  location: string | null;
}

export interface InventoryProductOption {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  minimumStock: number;
}

export interface LaravelPage<T> {
  data: T[];
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
}

export type InventoryFieldErrors = Record<string, string>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseId(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`The server returned an invalid ${label}.`);
  }
  return parsed;
}

export function numberValue(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`The server returned an invalid ${label}.`);
  }
  return parsed;
}

export function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body: unknown = error.response?.data;
    if (isRecord(body) && typeof body.message === "string") return body.message;
    if (!error.response) {
      return "Could not connect to the server. Check your connection and try again.";
    }
  }
  return error instanceof Error
    ? error.message
    : "The inventory request could not be completed.";
}

export function getValidationResult(error: unknown): {
  fields: InventoryFieldErrors;
  message: string;
} {
  const message = getErrorMessage(error);
  if (!axios.isAxiosError(error) || !isRecord(error.response?.data)) {
    return { fields: {}, message };
  }
  const body = error.response.data;
  const fields: InventoryFieldErrors = {};
  if (isRecord(body.errors)) {
    for (const [field, messages] of Object.entries(body.errors)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") {
        fields[field] = messages[0];
      }
    }
  }
  return { fields, message };
}

export function parseLaravelPage<T>(
  value: unknown,
  parse: (record: unknown) => T,
): LaravelPage<T> {
  if (!isRecord(value)) {
    throw new Error("The server returned an invalid paginated response.");
  }

  const paginator =
    isRecord(value.data) && Array.isArray(value.data.data) ? value.data : value;

  if (
    !Array.isArray(paginator.data) ||
    !Number.isInteger(paginator.current_page) ||
    !Number.isInteger(paginator.last_page) ||
    !Number.isInteger(paginator.per_page) ||
    !Number.isInteger(paginator.total)
  ) {
    throw new Error("The server returned invalid pagination information.");
  }

  return {
    data: paginator.data.map(parse),
    currentPage: paginator.current_page as number,
    lastPage: paginator.last_page as number,
    perPage: paginator.per_page as number,
    total: paginator.total as number,
  };
}

export async function fetchAllPages<T>(
  url: string,
  params: Record<string, string | number>,
  parse: (record: unknown) => T,
  signal: AbortSignal,
): Promise<T[]> {
  const records: T[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const { data } = await api.get<unknown>(url, {
      params: { ...params, page },
      signal,
    });
    const response = parseLaravelPage(data, (record) => record);
    records.push(...response.data.map(parse));
    lastPage = response.lastPage;
    page += 1;
  } while (page <= lastPage);
  return records;
}

export function parseWarehouseOption(value: unknown): InventoryWarehouseOption {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new Error("The warehouse list contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "warehouse ID"),
    name: value.name,
    location: optionalText(value.location),
  };
}

export function parseProductOption(value: unknown): InventoryProductOption {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.unit !== "string"
  ) {
    throw new Error("The product list contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "product ID"),
    name: value.name,
    sku: optionalText(value.sku),
    unit: value.unit,
    minimumStock: numberValue(value.minimum_stock ?? 0, "minimum stock"),
  };
}

export async function loadWarehouses(
  signal: AbortSignal,
): Promise<InventoryWarehouseOption[]> {
  return fetchAllPages(
    "/api/warehouses",
    { is_active: "true", per_page: 100 },
    parseWarehouseOption,
    signal,
  );
}

export async function loadProducts(
  signal: AbortSignal,
): Promise<InventoryProductOption[]> {
  return fetchAllPages(
    "/api/products",
    { is_active: "true", per_page: 100 },
    parseProductOption,
    signal,
  );
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
    value,
  );
}

export function formatCurrency(value: number, currency = "AFN"): string {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)} ${currency}`;
}

export function todayValue(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
