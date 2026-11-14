import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

interface ProductCategory {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface UnitOption {
  id: number;
  name: string;
  shortName: string | null;
  isActive: boolean;
}

interface Product {
  id: number;
  productCategoryId: number;
  sku: string | null;
  name: string;
  productType: string | null;
  unit: string;
  description: string | null;
  minimumStock: number;
  isActive: boolean;
  category: ProductCategory | null;
}

interface ProductPage {
  data: Product[];
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
}

interface ProductForm {
  productCategoryId: string;
  sku: string;
  name: string;
  productType: string;
  unit: string;
  description: string;
  minimumStock: string;
}

interface CategoryForm {
  name: string;
  description: string;
}

interface UnitForm {
  name: string;
  shortName: string;
  description: string;
}

type FieldErrors = Record<string, string>;

const emptyProductForm: ProductForm = {
  productCategoryId: "",
  sku: "",
  name: "",
  productType: "goods",
  unit: "",
  description: "",
  minimumStock: "0",
};

const emptyCategoryForm: CategoryForm = { name: "", description: "" };
const emptyUnitForm: UnitForm = { name: "", shortName: "", description: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseId(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`The server returned an invalid ${label}.`);
  return parsed;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseCategory(value: unknown): ProductCategory {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw new Error("The category response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "category ID"),
    name: value.name,
    description: optionalText(value.description),
    isActive: value.is_active,
  };
}

function parseUnit(value: unknown): UnitOption {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw new Error("The unit response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "unit ID"),
    name: value.name,
    shortName: optionalText(value.short_name),
    isActive: value.is_active,
  };
}

function parseProduct(value: unknown): Product {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.unit !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw new Error("The product response contains an incomplete record.");
  }
  const minimumStock = Number(value.minimum_stock ?? 0);
  if (!Number.isFinite(minimumStock))
    throw new Error("The server returned an invalid minimum stock value.");

  return {
    id: parseId(value.id, "product ID"),
    productCategoryId: parseId(
      value.product_category_id,
      "product category ID",
    ),
    sku: optionalText(value.sku),
    name: value.name,
    productType: optionalText(value.product_type),
    unit: value.unit,
    description: optionalText(value.description),
    minimumStock,
    isActive: value.is_active,
    category: isRecord(value.category) ? parseCategory(value.category) : null,
  };
}

function parseProductPage(value: unknown): ProductPage {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.data) ||
    !Number.isInteger(value.data.current_page) ||
    !Number.isInteger(value.data.last_page) ||
    !Number.isInteger(value.data.per_page) ||
    !Number.isInteger(value.data.total)
  ) {
    throw new Error("The product list did not contain valid pagination data.");
  }
  return {
    data: value.data.data.map(parseProduct),
    currentPage: value.data.current_page as number,
    lastPage: value.data.last_page as number,
    perPage: value.data.per_page as number,
    total: value.data.total as number,
  };
}

function parsePaginatedRecords(value: unknown): {
  records: unknown[];
  lastPage: number;
} {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("The option list response was not in the expected format.");
  }
  const paginator = value.data;
  const lastPage = Number(paginator.last_page);
  if (
    !Array.isArray(paginator.data) ||
    !Number.isInteger(lastPage) ||
    lastPage < 1
  ) {
    throw new Error("The option list did not contain valid pagination data.");
  }
  return { records: paginator.data, lastPage };
}

async function fetchAllPages(
  url: string,
  params: Record<string, string | number>,
  signal: AbortSignal,
): Promise<unknown[]> {
  const records: unknown[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const { data } = await api.get<unknown>(url, {
      params: { ...params, page },
      signal,
    });
    const result = parsePaginatedRecords(data);
    records.push(...result.records);
    lastPage = result.lastPage;
    page += 1;
  } while (page <= lastPage);
  return records;
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body: unknown = error.response?.data;
    if (isRecord(body) && typeof body.message === "string") return body.message;
    if (!error.response)
      return "Could not connect to the server. Check your connection and try again.";
  }
  return error instanceof Error
    ? error.message
    : "The product request could not be completed.";
}

function getValidationErrors(error: unknown): {
  fields: FieldErrors;
  message: string;
} {
  const message = getErrorMessage(error);
  if (!axios.isAxiosError(error) || !isRecord(error.response?.data)) {
    return { fields: {}, message };
  }
  const body = error.response.data;
  const fieldMap: Record<string, string> = {
    product_category_id: "productCategoryId",
    minimum_stock: "minimumStock",
    short_name: "shortName",
  };
  const fields: FieldErrors = {};
  if (isRecord(body.errors)) {
    for (const [field, messages] of Object.entries(body.errors)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") {
        fields[fieldMap[field] ?? field] = messages[0];
      }
    }
  }
  return { fields, message };
}

function getCategoryValidationErrors(error: unknown): {
  fields: FieldErrors;
  message: string;
} {
  const result = getValidationErrors(error);
  return { fields: result.fields, message: result.message };
}

function formatStock(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
    value,
  );
}

export default function Products() {
  const [products, setProducts] = useState<ProductPage | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("");
  const [debouncedProductType, setDebouncedProductType] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listRetry, setListRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProductForm);
  const [formFields, setFormFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(
    null,
  );
  const [productDetails, setProductDetails] = useState<Product | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categoryFormMode, setCategoryFormMode] = useState<
    "create" | "edit" | null
  >(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [categoryForm, setCategoryForm] =
    useState<CategoryForm>(emptyCategoryForm);
  const [categoryFields, setCategoryFields] = useState<FieldErrors>({});
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [unitFormMode, setUnitFormMode] = useState<"create" | "edit" | null>(
    null,
  );
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnitForm);
  const [unitFields, setUnitFields] = useState<FieldErrors>({});
  const [unitError, setUnitError] = useState<string | null>(null);
  const [unitLoading, setUnitLoading] = useState(false);
  const [unitSaving, setUnitSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedProductType(productTypeFilter.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [productTypeFilter]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setListError(null);
    api
      .get<unknown>("/api/products", {
        params: {
          search: debouncedSearch || undefined,
          product_category_id: categoryFilter || undefined,
          product_type: debouncedProductType || undefined,
          is_active: statusFilter === "all" ? undefined : statusFilter,
          per_page: 10,
          page,
        },
        signal: controller.signal,
      })
      .then(({ data }) => setProducts(parseProductPage(data)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setProducts(null);
          setListError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [
    debouncedSearch,
    categoryFilter,
    debouncedProductType,
    statusFilter,
    page,
    listRetry,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    setCategoriesLoading(true);
    setCategoriesError(null);
    void fetchAllPages(
      "/api/product-categories",
      { per_page: 100 },
      controller.signal,
    )
      .then((records) => setCategories(records.map(parseCategory)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCategories([]);
          setCategoriesError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCategoriesLoading(false);
      });

    setUnitsLoading(true);
    setUnitsError(null);
    void fetchAllPages("/api/units", { per_page: 100 }, controller.signal)
      .then((records) => setUnits(records.map(parseUnit)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setUnits([]);
          setUnitsError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setUnitsLoading(false);
      });
    return () => controller.abort();
  }, [catalogRetry]);

  useEffect(() => {
    if (selectedProductId === null) return;
    const controller = new AbortController();
    setIsDetailLoading(true);
    setDetailError(null);
    setProductDetails(null);
    api
      .get<unknown>(`/api/products/${selectedProductId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data))
          throw new Error("The product details response was incomplete.");
        setProductDetails(parseProduct(data.data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedProductId, detailRetry]);

  useEffect(() => {
    if (selectedProductId === null && !categoriesOpen && !unitsOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedProductId(null);
        setCategoriesOpen(false);
        setUnitsOpen(false);
        setCategoryFormMode(null);
        setUnitFormMode(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedProductId, categoriesOpen, unitsOpen]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function openCreateForm() {
    setForm(emptyProductForm);
    setFormFields({});
    setFormError(null);
    setFormMode("create");
  }

  function openEditForm(product: Product) {
    setForm({
      productCategoryId: String(product.productCategoryId),
      sku: product.sku ?? "",
      name: product.name,
      productType: product.productType ?? "",
      unit: product.unit,
      description: product.description ?? "",
      minimumStock: String(product.minimumStock),
    });
    setFormFields({});
    setFormError(null);
    setSelectedProductId(null);
    setFormMode("edit");
  }

  function closeProductForm() {
    if (isSaving) return;
    setFormMode(null);
    setForm(emptyProductForm);
    setFormFields({});
    setFormError(null);
  }

  function setProductField(field: keyof ProductForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormFields((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
    setSuccess(null);
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || !formMode) return;

    const fields: FieldErrors = {};
    if (!form.productCategoryId)
      fields.productCategoryId = "Select a category.";
    if (!form.name.trim()) fields.name = "Enter a product name.";
    if (!form.unit.trim()) fields.unit = "Enter a unit.";
    if (form.name.trim().length > 255)
      fields.name = "Product name cannot exceed 255 characters.";
    if (form.sku.trim().length > 255)
      fields.sku = "SKU cannot exceed 255 characters.";
    if (form.productType.trim().length > 30)
      fields.productType = "Product type cannot exceed 30 characters.";
    if (form.unit.trim().length > 30)
      fields.unit = "Unit cannot exceed 30 characters.";
    if (form.minimumStock.trim()) {
      const minimumStock = Number(form.minimumStock);
      if (!Number.isFinite(minimumStock) || minimumStock < 0) {
        fields.minimumStock = "Enter a non-negative number.";
      }
    }
    setFormFields(fields);
    if (Object.keys(fields).length) {
      setFormError("Check the highlighted fields.");
      return;
    }

    const payload: Record<string, string | number | null> = {
      product_category_id: Number(form.productCategoryId),
      sku: form.sku.trim() || null,
      name: form.name.trim(),
      unit: form.unit.trim(),
      description: form.description.trim() || null,
    };
    if (form.productType.trim()) payload.product_type = form.productType.trim();
    if (form.minimumStock.trim())
      payload.minimum_stock = Number(form.minimumStock);

    setIsSaving(true);
    setFormError(null);
    try {
      if (formMode === "create") {
        await api.post("/api/products", payload);
        setSuccess("Product created successfully.");
      } else {
        if (!productDetails)
          throw new Error("Product details are not available for editing.");
        await api.put(`/api/products/${productDetails.id}`, payload);
        setSuccess("Product updated successfully.");
      }
      setFormMode(null);
      setForm(emptyProductForm);
      setPage(1);
      setListRetry((current) => current + 1);
    } catch (error: unknown) {
      const result = getValidationErrors(error);
      setFormFields(result.fields);
      setFormError(result.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function deactivateProduct() {
    if (!productDetails || !productDetails.isActive || isDeactivating) return;
    if (
      !window.confirm(
        `Deactivate ${productDetails.name}? This will make it unavailable in new transactions.`,
      )
    ) {
      return;
    }
    setIsDeactivating(true);
    setDetailError(null);
    try {
      const { data } = await api.patch<unknown>(
        `/api/products/${productDetails.id}/deactivate`,
      );
      if (!isRecord(data) || !("data" in data))
        throw new Error("The product deactivation response was incomplete.");
      const updatedProduct = parseProduct(data.data);
      setProductDetails(updatedProduct);
      setSuccess("Product deactivated successfully.");
      setListRetry((current) => current + 1);
    } catch (error: unknown) {
      setDetailError(getErrorMessage(error));
    } finally {
      setIsDeactivating(false);
    }
  }

  function openCategories() {
    setCategoriesOpen(true);
    setCategoryFormMode(null);
    setSelectedCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryFields({});
    setCategoryError(null);
  }

  function startCreateCategory() {
    setSelectedCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryFields({});
    setCategoryError(null);
    setCategoryFormMode("create");
  }

  async function startEditCategory(category: ProductCategory) {
    setCategoryFormMode("edit");
    setSelectedCategoryId(category.id);
    setCategoryFields({});
    setCategoryError(null);
    setCategoryLoading(true);
    try {
      const { data } = await api.get<unknown>(
        `/api/product-categories/${category.id}`,
      );
      if (!isRecord(data) || !("data" in data))
        throw new Error("The category details response was incomplete.");
      const loadedCategory = parseCategory(data.data);
      setCategoryForm({
        name: loadedCategory.name,
        description: loadedCategory.description ?? "",
      });
    } catch (error: unknown) {
      setCategoryError(getErrorMessage(error));
    } finally {
      setCategoryLoading(false);
    }
  }

  function setCategoryField(field: keyof CategoryForm, value: string) {
    setCategoryForm((current) => ({ ...current, [field]: value }));
    setCategoryFields((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setCategoryError(null);
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (categorySaving || !categoryFormMode) return;
    const fields: FieldErrors = {};
    if (!categoryForm.name.trim()) fields.name = "Enter a category name.";
    if (categoryForm.name.trim().length > 255)
      fields.name = "Category name cannot exceed 255 characters.";
    setCategoryFields(fields);
    if (Object.keys(fields).length) {
      setCategoryError("Check the highlighted fields.");
      return;
    }

    setCategorySaving(true);
    setCategoryError(null);
    try {
      const payload = {
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim() || null,
      };
      const response =
        categoryFormMode === "create"
          ? await api.post<unknown>("/api/product-categories", payload)
          : await api.put<unknown>(
              `/api/product-categories/${selectedCategoryId}`,
              payload,
            );
      if (!isRecord(response.data) || !("data" in response.data))
        throw new Error("The category save response was incomplete.");
      const savedCategory = parseCategory(response.data.data);
      if (categoryFormMode === "create" && savedCategory.isActive) {
        setForm((current) => ({
          ...current,
          productCategoryId: String(savedCategory.id),
        }));
      }
      setCategoryFormMode(null);
      setSelectedCategoryId(null);
      setCategoryRetryAfterSave();
      setSuccess(
        categoryFormMode === "create"
          ? "Category created successfully."
          : "Category updated successfully.",
      );
    } catch (error: unknown) {
      const result = getCategoryValidationErrors(error);
      setCategoryFields(result.fields);
      setCategoryError(result.message);
    } finally {
      setCategorySaving(false);
    }
  }

  function setCategoryRetryAfterSave() {
    setCatalogRetry((current) => current + 1);
  }

  async function deactivateCategory(category: ProductCategory) {
    if (!category.isActive) return;
    if (!window.confirm(`Deactivate the category "${category.name}"?`)) return;
    try {
      await api.patch(`/api/product-categories/${category.id}/deactivate`);
      if (form.productCategoryId === String(category.id)) {
        setForm((current) => ({ ...current, productCategoryId: "" }));
      }
      setCatalogRetry((current) => current + 1);
      setCategoryFormMode(null);
      setCategoryError(null);
    } catch (error: unknown) {
      setCategoryError(getErrorMessage(error));
    }
  }

  function closeCategories() {
    if (categorySaving || categoryLoading) return;
    setCategoriesOpen(false);
    setCategoryFormMode(null);
    setSelectedCategoryId(null);
    setCategoryError(null);
  }

  function openUnits() {
    setUnitsOpen(true);
    setUnitFormMode(null);
    setSelectedUnitId(null);
    setUnitForm(emptyUnitForm);
    setUnitFields({});
    setUnitError(null);
  }

  function startCreateUnit() {
    setSelectedUnitId(null);
    setUnitForm(emptyUnitForm);
    setUnitFields({});
    setUnitError(null);
    setUnitFormMode("create");
  }

  async function startEditUnit(unit: UnitOption) {
    setUnitFormMode("edit");
    setSelectedUnitId(unit.id);
    setUnitFields({});
    setUnitError(null);
    setUnitLoading(true);
    try {
      const { data } = await api.get<unknown>(`/api/units/${unit.id}`);
      if (!isRecord(data) || !("data" in data))
        throw new Error("The unit details response was incomplete.");
      const unitValue = data.data;
      if (!isRecord(unitValue))
        throw new Error("The unit details response was incomplete.");
      const loadedUnit = parseUnit(unitValue);
      setUnitForm({
        name: loadedUnit.name,
        shortName: loadedUnit.shortName ?? "",
        description:
          typeof unitValue.description === "string"
            ? unitValue.description
            : "",
      });
    } catch (error: unknown) {
      setUnitError(getErrorMessage(error));
    } finally {
      setUnitLoading(false);
    }
  }

  function setUnitField(field: keyof UnitForm, value: string) {
    setUnitForm((current) => ({ ...current, [field]: value }));
    setUnitFields((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setUnitError(null);
  }

  async function submitUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unitSaving || !unitFormMode) return;
    const fields: FieldErrors = {};
    if (!unitForm.name.trim()) fields.name = "Enter a unit name.";
    if (unitForm.name.trim().length > 100)
      fields.name = "Unit name cannot exceed 100 characters.";
    if (unitForm.shortName.trim().length > 20)
      fields.shortName = "Short name cannot exceed 20 characters.";
    if (unitForm.description.length > 2000)
      fields.description = "Description cannot exceed 2000 characters.";
    setUnitFields(fields);
    if (Object.keys(fields).length) {
      setUnitError("Check the highlighted fields.");
      return;
    }

    setUnitSaving(true);
    setUnitError(null);
    try {
      const payload = {
        name: unitForm.name.trim(),
        short_name: unitForm.shortName.trim() || null,
        description: unitForm.description.trim() || null,
      };
      const response =
        unitFormMode === "create"
          ? await api.post<unknown>("/api/units", payload)
          : await api.put<unknown>(`/api/units/${selectedUnitId}`, payload);
      if (!isRecord(response.data) || !("data" in response.data))
        throw new Error("The unit save response was incomplete.");
      const savedUnit = parseUnit(response.data.data);
      if (savedUnit.isActive) {
        setForm((current) => ({ ...current, unit: savedUnit.name }));
      }
      setUnitFormMode(null);
      setSelectedUnitId(null);
      setCatalogRetry((current) => current + 1);
      setSuccess(
        unitFormMode === "create"
          ? "Unit created successfully."
          : "Unit updated successfully.",
      );
    } catch (error: unknown) {
      const result = getValidationErrors(error);
      setUnitFields(result.fields);
      setUnitError(result.message);
    } finally {
      setUnitSaving(false);
    }
  }

  async function deactivateUnit(unit: UnitOption) {
    if (!unit.isActive) return;
    if (!window.confirm(`Deactivate the unit "${unit.name}"?`)) return;
    try {
      await api.patch(`/api/units/${unit.id}/deactivate`);
      if (form.unit === unit.name) {
        setForm((current) => ({ ...current, unit: "" }));
      }
      setCatalogRetry((current) => current + 1);
      setUnitFormMode(null);
      setUnitError(null);
    } catch (error: unknown) {
      setUnitError(getErrorMessage(error));
    }
  }

  function closeUnits() {
    if (unitSaving || unitLoading) return;
    setUnitsOpen(false);
    setUnitFormMode(null);
    setSelectedUnitId(null);
    setUnitError(null);
  }

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  const activeCategories = categories.filter((category) => category.isActive);
  const activeUnits = units.filter((unit) => unit.isActive);
  const formCategories = categories.filter(
    (category) =>
      category.isActive ||
      (formMode === "edit" && category.id === Number(form.productCategoryId)),
  );
  const startRecord =
    products && products.total > 0
      ? (products.currentPage - 1) * products.perPage + 1
      : 0;
  const endRecord = products
    ? Math.min(
        (products.currentPage - 1) * products.perPage + products.data.length,
        products.total,
      )
    : 0;

  return (
    <div className="purchases-page products-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">INVENTORY</p>
          <h1>Products</h1>
          <p className="overview-heading__description">
            Manage product details, units, and categories.
          </p>
        </div>
        <button
          className="purchase-create-button"
          type="button"
          onClick={openCreateForm}
          disabled={formMode !== null}
        >
          <Plus size={16} aria-hidden="true" />
          <span>New Product</span>
        </button>
      </header>

      {success && (
        <p className="purchase-success-message products-success" role="status">
          {success}
        </p>
      )}

      {formMode && (
        <section
          className="purchases-panel products-form-panel"
          aria-labelledby="product-form-title"
        >
          <header className="products-form-heading">
            <h2 id="product-form-title">
              {formMode === "create" ? "Create Product" : "Edit Product"}
            </h2>
            <button
              type="button"
              className="purchase-cancel-button"
              onClick={closeProductForm}
              disabled={isSaving}
            >
              Cancel
            </button>
          </header>
          {formError && (
            <p
              className="create-purchase-alert products-form-alert"
              role="alert"
            >
              {formError}
            </p>
          )}
          <form
            className="products-form"
            onSubmit={(event) => void submitProduct(event)}
            noValidate
          >
            <div className="purchase-field">
              <label htmlFor="product-category">
                <span>
                  Category <i>*</i>
                </span>
              </label>
              <div className="products-category-select">
                <select
                  id="product-category"
                  value={form.productCategoryId}
                  onChange={(event) =>
                    setProductField("productCategoryId", event.target.value)
                  }
                  disabled={categoriesLoading || Boolean(categoriesError)}
                  aria-invalid={Boolean(formFields.productCategoryId)}
                >
                  <option value="">
                    {categoriesLoading
                      ? "Loading categories..."
                      : activeCategories.length
                        ? "Select category"
                        : "No active categories"}
                  </option>
                  {formCategories.map((category) => (
                    <option
                      value={category.id}
                      key={category.id}
                      disabled={!category.isActive}
                    >
                      {category.name}
                      {category.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="purchase-view-button"
                  onClick={openCategories}
                  aria-label="Manage product categories"
                >
                  Manage
                </button>
              </div>
              {categoriesError && (
                <small className="purchase-field__error">
                  {categoriesError}{" "}
                  <button
                    type="button"
                    onClick={() => setCatalogRetry((current) => current + 1)}
                  >
                    Retry
                  </button>
                </small>
              )}
              {formFields.productCategoryId && (
                <small className="purchase-field__error">
                  {formFields.productCategoryId}
                </small>
              )}
            </div>

            <label className="purchase-field">
              <span>
                Name <i>*</i>
              </span>
              <input
                value={form.name}
                onChange={(event) =>
                  setProductField("name", event.target.value)
                }
                maxLength={255}
                aria-invalid={Boolean(formFields.name)}
              />
              {formFields.name && (
                <small className="purchase-field__error">
                  {formFields.name}
                </small>
              )}
            </label>

            <label className="purchase-field">
              <span>SKU</span>
              <input
                value={form.sku}
                onChange={(event) => setProductField("sku", event.target.value)}
                maxLength={255}
                aria-invalid={Boolean(formFields.sku)}
              />
              {formFields.sku && (
                <small className="purchase-field__error">
                  {formFields.sku}
                </small>
              )}
            </label>

            <label className="purchase-field">
              <span>Product Type</span>
              <input
                value={form.productType}
                onChange={(event) =>
                  setProductField("productType", event.target.value)
                }
                maxLength={30}
                aria-invalid={Boolean(formFields.productType)}
              />
              {formFields.productType && (
                <small className="purchase-field__error">
                  {formFields.productType}
                </small>
              )}
            </label>

            <div className="purchase-field">
              <label htmlFor="product-unit">
                <span>
                  Unit <i>*</i>
                </span>
              </label>
              <div className="products-category-select">
                <select
                  id="product-unit"
                  value={form.unit}
                  onChange={(event) =>
                    setProductField("unit", event.target.value)
                  }
                  disabled={unitsLoading || Boolean(unitsError)}
                  aria-invalid={Boolean(formFields.unit)}
                >
                  <option value="">
                    {unitsLoading
                      ? "Loading units..."
                      : activeUnits.length
                        ? "Select unit"
                        : "No active units"}
                  </option>
                  {formMode === "edit" &&
                    form.unit &&
                    !activeUnits.some((unit) => unit.name === form.unit) && (
                      <option value={form.unit}>{form.unit} (current)</option>
                    )}
                  {activeUnits.map((unit) => (
                    <option key={unit.id} value={unit.name}>
                      {unit.name}
                      {unit.shortName ? ` (${unit.shortName})` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="purchase-view-button"
                  onClick={openUnits}
                  aria-label="Manage units"
                >
                  Manage
                </button>
              </div>
              {unitsLoading && (
                <small className="purchase-field__hint">Loading units...</small>
              )}
              {unitsError && (
                <small className="purchase-field__error">
                  {unitsError}{" "}
                  <button
                    type="button"
                    onClick={() => setCatalogRetry((current) => current + 1)}
                  >
                    Retry
                  </button>
                </small>
              )}
              {formFields.unit && (
                <small className="purchase-field__error">
                  {formFields.unit}
                </small>
              )}
            </div>

            <label className="purchase-field">
              <span>Minimum Stock</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.minimumStock}
                onChange={(event) =>
                  setProductField("minimumStock", event.target.value)
                }
                aria-invalid={Boolean(formFields.minimumStock)}
              />
              {formFields.minimumStock && (
                <small className="purchase-field__error">
                  {formFields.minimumStock}
                </small>
              )}
            </label>

            <label className="purchase-field products-form-wide">
              <span>Description</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) =>
                  setProductField("description", event.target.value)
                }
                aria-invalid={Boolean(formFields.description)}
              />
              {formFields.description && (
                <small className="purchase-field__error">
                  {formFields.description}
                </small>
              )}
            </label>

            <div className="products-form-actions">
              <button
                type="button"
                className="purchase-cancel-button"
                onClick={closeProductForm}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="purchase-save-button"
                disabled={
                  isSaving || categoriesLoading || Boolean(categoriesError)
                }
              >
                {isSaving
                  ? "Saving…"
                  : formMode === "create"
                    ? "Create Product"
                    : "Save Changes"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="purchases-panel" aria-label="Product list">
        <div className="products-toolbar">
          <label className="products-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => updateFilter(setSearch, event.target.value)}
              placeholder="Search name or SKU"
              aria-label="Search products by name or SKU"
            />
          </label>
          <label className="products-filter">
            <span>Category</span>
            <select
              value={categoryFilter}
              onChange={(event) =>
                updateFilter(setCategoryFilter, event.target.value)
              }
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {category.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <label className="products-filter products-type-filter">
            <span>Product Type</span>
            <input
              value={productTypeFilter}
              onChange={(event) =>
                updateFilter(setProductTypeFilter, event.target.value)
              }
              placeholder="All types"
              aria-label="Filter by product type"
            />
          </label>
          <label className="products-filter">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                updateFilter(setStatusFilter, event.target.value)
              }
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <button
            className="overview-refresh"
            type="button"
            onClick={() => setListRetry((current) => current + 1)}
            disabled={isLoading}
            aria-label="Refresh products"
          >
            <RefreshCw
              size={16}
              className={isLoading ? "overview-refresh__spinning" : ""}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
        </div>

        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" /> Loading products…
          </div>
        ) : listError ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{listError}</span>
            <button
              type="button"
              className="purchases-retry"
              onClick={() => setListRetry((current) => current + 1)}
            >
              Try again
            </button>
          </div>
        ) : products && products.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <span className="purchases-empty-mark">
              <Eye size={21} aria-hidden="true" />
            </span>
            <strong>
              {debouncedSearch ||
              debouncedProductType ||
              categoryFilter ||
              statusFilter !== "all"
                ? "No products match these filters"
                : "No products yet"}
            </strong>
            <span>
              {debouncedSearch ||
              debouncedProductType ||
              categoryFilter ||
              statusFilter !== "all"
                ? "Adjust the search or filters and try again."
                : "Create a product to see it listed here."}
            </span>
          </div>
        ) : products ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table products-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>SKU</th>
                    <th>Category</th>
                    <th>Type</th>
                    <th>Unit</th>
                    <th className="purchases-table__numeric">Minimum Stock</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.data.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <strong className="purchases-number">
                          {product.name}
                        </strong>
                      </td>
                      <td>{product.sku || "—"}</td>
                      <td>{product.category?.name || "—"}</td>
                      <td>{product.productType || "—"}</td>
                      <td>{product.unit}</td>
                      <td className="purchases-table__numeric">
                        {formatStock(product.minimumStock)}
                      </td>
                      <td>
                        <span
                          className={`product-status ${product.isActive ? "product-status--active" : "product-status--inactive"}`}
                        >
                          {product.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() => setSelectedProductId(product.id)}
                          aria-label={`View ${product.name}`}
                        >
                          <Eye size={15} aria-hidden="true" />
                          <span>Details</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="purchases-pagination">
              <span>
                Showing {startRecord}–{endRecord} of{" "}
                {new Intl.NumberFormat().format(products.total)} products
              </span>
              <div className="purchases-pagination__controls">
                <button
                  type="button"
                  onClick={() => setPage(products.currentPage - 1)}
                  disabled={isLoading || products.currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} aria-hidden="true" /> Previous
                </button>
                <span>
                  Page <strong>{products.currentPage}</strong> of{" "}
                  <strong>{products.lastPage}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPage(products.currentPage + 1)}
                  disabled={
                    isLoading || products.currentPage >= products.lastPage
                  }
                  aria-label="Next page"
                >
                  Next <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {selectedProductId !== null && (
        <div
          className="purchase-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setSelectedProductId(null);
          }}
        >
          <section
            className="purchase-modal product-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-detail-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">PRODUCT DETAILS</p>
                <h2 id="product-detail-title">
                  {productDetails?.name ?? "Product"}
                </h2>
                {productDetails && <p>Product #{productDetails.id}</p>}
              </div>
              <button
                type="button"
                className="purchase-modal__close"
                onClick={() => setSelectedProductId(null)}
                aria-label="Close details"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div className="purchase-modal__body">
              {isDetailLoading ? (
                <div className="purchases-state" role="status">
                  <span className="loading-spinner" /> Loading product details…
                </div>
              ) : detailError ? (
                <div
                  className="purchases-state purchases-state--error"
                  role="alert"
                >
                  <AlertCircle size={20} aria-hidden="true" />
                  <span>{detailError}</span>
                  <button
                    type="button"
                    className="purchases-retry"
                    onClick={() => setDetailRetry((current) => current + 1)}
                  >
                    Try again
                  </button>
                </div>
              ) : productDetails ? (
                <>
                  <dl className="purchase-detail-grid product-detail-grid">
                    <div>
                      <dt>Name</dt>
                      <dd>{productDetails.name}</dd>
                    </div>
                    <div>
                      <dt>SKU</dt>
                      <dd>{productDetails.sku || "—"}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{productDetails.category?.name || "—"}</dd>
                    </div>
                    <div>
                      <dt>Product Type</dt>
                      <dd>{productDetails.productType || "—"}</dd>
                    </div>
                    <div>
                      <dt>Unit</dt>
                      <dd>{productDetails.unit}</dd>
                    </div>
                    <div>
                      <dt>Minimum Stock</dt>
                      <dd>{formatStock(productDetails.minimumStock)}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{productDetails.isActive ? "Active" : "Inactive"}</dd>
                    </div>
                  </dl>
                  <div className="product-detail-description">
                    <strong>Description</strong>
                    <p>{productDetails.description || "—"}</p>
                  </div>
                  {detailError && (
                    <p className="form-alert form-alert--error" role="alert">
                      {detailError}
                    </p>
                  )}
                  <div className="product-detail-actions">
                    <button
                      className="purchase-view-button"
                      type="button"
                      onClick={() => openEditForm(productDetails)}
                    >
                      <Pencil size={15} aria-hidden="true" /> Edit Product
                    </button>
                    {productDetails.isActive && (
                      <button
                        className="product-deactivate-button"
                        type="button"
                        onClick={() => void deactivateProduct()}
                        disabled={isDeactivating}
                      >
                        {isDeactivating ? "Deactivating..." : "Deactivate"}
                      </button>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {categoriesOpen && (
        <div
          className="purchase-modal-backdrop product-category-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCategories();
          }}
        >
          <section
            className="purchase-modal product-category-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-category-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">PRODUCT SETUP</p>
                <h2 id="product-category-title">Product Categories</h2>
              </div>
              <button
                type="button"
                className="purchase-modal__close"
                onClick={closeCategories}
                aria-label="Close categories"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div className="purchase-modal__body">
              {categoriesError && (
                <div
                  className="purchases-state purchases-state--error"
                  role="alert"
                >
                  <span>{categoriesError}</span>
                  <button
                    type="button"
                    className="purchases-retry"
                    onClick={() => setCatalogRetry((current) => current + 1)}
                  >
                    Retry
                  </button>
                </div>
              )}
              {categoryError && (
                <p
                  className="create-purchase-alert products-form-alert"
                  role="alert"
                >
                  {categoryError}
                </p>
              )}
              {categoryFormMode ? (
                <form
                  className="product-category-form"
                  onSubmit={(event) => void submitCategory(event)}
                  noValidate
                >
                  <h3>
                    {categoryFormMode === "create"
                      ? "New Category"
                      : "Edit Category"}
                  </h3>
                  {categoryLoading ? (
                    <div className="purchases-state" role="status">
                      <span className="loading-spinner" /> Loading category…
                    </div>
                  ) : (
                    <>
                      <label className="purchase-field">
                        <span>
                          Name <i>*</i>
                        </span>
                        <input
                          value={categoryForm.name}
                          onChange={(event) =>
                            setCategoryField("name", event.target.value)
                          }
                          maxLength={255}
                          aria-invalid={Boolean(categoryFields.name)}
                        />
                        {categoryFields.name && (
                          <small className="purchase-field__error">
                            {categoryFields.name}
                          </small>
                        )}
                      </label>
                      <label className="purchase-field">
                        <span>Description</span>
                        <textarea
                          rows={2}
                          value={categoryForm.description}
                          onChange={(event) =>
                            setCategoryField("description", event.target.value)
                          }
                        />
                      </label>
                      <div className="product-category-form-actions">
                        <button
                          type="button"
                          className="purchase-cancel-button"
                          onClick={() => setCategoryFormMode(null)}
                          disabled={categorySaving}
                        >
                          Back
                        </button>
                        <button
                          type="submit"
                          className="purchase-save-button"
                          disabled={categorySaving}
                        >
                          {categorySaving ? "Saving…" : "Save Category"}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              ) : (
                <>
                  <div className="product-category-toolbar">
                    <span>{categories.length} categories</span>
                    <button
                      className="purchase-create-button"
                      type="button"
                      onClick={startCreateCategory}
                    >
                      <Plus size={15} aria-hidden="true" /> New Category
                    </button>
                  </div>
                  {categoriesLoading ? (
                    <div className="purchases-state" role="status">
                      <span className="loading-spinner" /> Loading categories…
                    </div>
                  ) : categories.length === 0 ? (
                    <div className="purchases-state purchases-state--empty">
                      <strong>No categories yet</strong>
                    </div>
                  ) : (
                    <div className="product-category-list">
                      {categories.map((category) => (
                        <div className="product-category-row" key={category.id}>
                          <div>
                            <strong>{category.name}</strong>
                            <span>
                              {category.description || "No description"}
                            </span>
                          </div>
                          <span
                            className={`product-status ${category.isActive ? "product-status--active" : "product-status--inactive"}`}
                          >
                            {category.isActive ? "Active" : "Inactive"}
                          </span>
                          <button
                            className="purchase-view-button"
                            type="button"
                            onClick={() => void startEditCategory(category)}
                            aria-label={`Edit ${category.name}`}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </button>
                          {category.isActive && (
                            <button
                              className="product-deactivate-button"
                              type="button"
                              onClick={() => void deactivateCategory(category)}
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {categoryError && !categoryFormMode && (
                <div
                  className="purchases-state purchases-state--error"
                  role="alert"
                >
                  {categoryError}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {unitsOpen && (
        <div
          className="purchase-modal-backdrop product-unit-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeUnits();
          }}
        >
          <section
            className="purchase-modal product-unit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-unit-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">PRODUCT SETUP</p>
                <h2 id="product-unit-title">Units</h2>
              </div>
              <button
                type="button"
                className="purchase-modal__close"
                onClick={closeUnits}
                aria-label="Close units"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div className="purchase-modal__body">
              {unitError && (
                <p
                  className="create-purchase-alert products-form-alert"
                  role="alert"
                >
                  {unitError}
                </p>
              )}
              {unitFormMode ? (
                <form
                  className="product-category-form"
                  onSubmit={(event) => void submitUnit(event)}
                  noValidate
                >
                  <h3>
                    {unitFormMode === "create" ? "New Unit" : "Edit Unit"}
                  </h3>
                  {unitLoading ? (
                    <div className="purchases-state" role="status">
                      <span className="loading-spinner" /> Loading unit…
                    </div>
                  ) : (
                    <>
                      <label className="purchase-field">
                        <span>
                          Name <i>*</i>
                        </span>
                        <input
                          value={unitForm.name}
                          onChange={(event) =>
                            setUnitField("name", event.target.value)
                          }
                          maxLength={100}
                          aria-invalid={Boolean(unitFields.name)}
                        />
                        {unitFields.name && (
                          <small className="purchase-field__error">
                            {unitFields.name}
                          </small>
                        )}
                      </label>
                      <label className="purchase-field">
                        <span>Short Name</span>
                        <input
                          value={unitForm.shortName}
                          onChange={(event) =>
                            setUnitField("shortName", event.target.value)
                          }
                          maxLength={20}
                          aria-invalid={Boolean(unitFields.shortName)}
                        />
                        {unitFields.shortName && (
                          <small className="purchase-field__error">
                            {unitFields.shortName}
                          </small>
                        )}
                      </label>
                      <label className="purchase-field">
                        <span>Description</span>
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={unitForm.description}
                          onChange={(event) =>
                            setUnitField("description", event.target.value)
                          }
                          aria-invalid={Boolean(unitFields.description)}
                        />
                        {unitFields.description && (
                          <small className="purchase-field__error">
                            {unitFields.description}
                          </small>
                        )}
                      </label>
                      <div className="product-category-form-actions">
                        <button
                          type="button"
                          className="purchase-cancel-button"
                          onClick={() => setUnitFormMode(null)}
                          disabled={unitSaving}
                        >
                          Back
                        </button>
                        <button
                          type="submit"
                          className="purchase-save-button"
                          disabled={unitSaving}
                        >
                          {unitSaving ? "Saving…" : "Save Unit"}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              ) : (
                <>
                  <div className="product-category-toolbar">
                    <span>{units.length} units</span>
                    <button
                      className="purchase-create-button"
                      type="button"
                      onClick={startCreateUnit}
                    >
                      <Plus size={15} aria-hidden="true" /> New Unit
                    </button>
                  </div>
                  {unitsLoading ? (
                    <div className="purchases-state" role="status">
                      <span className="loading-spinner" /> Loading units…
                    </div>
                  ) : units.length === 0 ? (
                    <div className="purchases-state purchases-state--empty">
                      <strong>No units yet</strong>
                    </div>
                  ) : (
                    <div className="product-category-list">
                      {units.map((unit) => (
                        <div className="product-category-row" key={unit.id}>
                          <div>
                            <strong>
                              {unit.name}
                              {unit.shortName ? ` (${unit.shortName})` : ""}
                            </strong>
                            <span>
                              {unit.isActive
                                ? "Available for products"
                                : "Inactive"}
                            </span>
                          </div>
                          <span
                            className={`product-status ${unit.isActive ? "product-status--active" : "product-status--inactive"}`}
                          >
                            {unit.isActive ? "Active" : "Inactive"}
                          </span>
                          <button
                            className="purchase-view-button"
                            type="button"
                            onClick={() => void startEditUnit(unit)}
                            aria-label={`Edit ${unit.name}`}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </button>
                          {unit.isActive && (
                            <button
                              className="product-deactivate-button"
                              type="button"
                              onClick={() => void deactivateUnit(unit)}
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
