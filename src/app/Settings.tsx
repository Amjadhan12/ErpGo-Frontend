import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, ImagePlus, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { api, getPublicStorageUrl } from "@/lib/api";
import { getErrorMessage, getValidationResult, isRecord, optionalText, parseId } from "@/app/InventoryShared";
import { useAuth } from "@/auth/AuthContext";
import { useLocale } from "@/lib/locale";

interface OrganizationSettings {
  id: number;
  titlePa: string;
  titleEn: string;
  phone1: string;
  phone2: string;
  address: string;
  billText: string;
  imagePath: string | null;
}

interface FormValues {
  title_pa: string;
  title_en: string;
  phone1: string;
  phone2: string;
  address: string;
  bill_text: string;
}

const blankValues: FormValues = { title_pa: "", title_en: "", phone1: "", phone2: "", address: "", bill_text: "" };

function parseSettings(value: unknown): OrganizationSettings {
  if (!isRecord(value) || typeof value.title_pa !== "string" || typeof value.title_en !== "string") {
    throw new Error("The settings response is incomplete.");
  }
  return {
    id: parseId(value.id, "settings ID"),
    titlePa: value.title_pa,
    titleEn: value.title_en,
    phone1: typeof value.phone1 === "string" ? value.phone1 : "",
    phone2: typeof value.phone2 === "string" ? value.phone2 : "",
    address: typeof value.address === "string" ? value.address : "",
    billText: typeof value.bill_text === "string" ? value.bill_text : "",
    imagePath: optionalText(value.image_path),
  };
}

function valuesFromSettings(settings: OrganizationSettings): FormValues {
  return { title_pa: settings.titlePa, title_en: settings.titleEn, phone1: settings.phone1, phone2: settings.phone2, address: settings.address, bill_text: settings.billText };
}

export default function SettingsPage() {
  const { direction, t } = useLocale();
  const { refreshCompanyBranding } = useAuth();
  const [setting, setSetting] = useState<OrganizationSettings | null>(null);
  const [values, setValues] = useState<FormValues>(blankValues);
  const [logo, setLogo] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    void api.get<unknown>("/api/settings", { signal: controller.signal }).then(({ data }) => {
      if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The settings list response is incomplete.");
      const latest = data.data[0] ? parseSettings(data.data[0]) : null;
      setSetting(latest);
      setValues(latest ? valuesFromSettings(latest) : blankValues);
      setLogo(null);
    }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(getErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => {
    if (logo) {
      const objectUrl = URL.createObjectURL(logo);
      setLogoPreview(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    setLogoPreview(setting?.imagePath ? getPublicStorageUrl(setting.imagePath) : null);
  }, [logo, setting?.imagePath]);

  function updateValue(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  function handleLogo(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setLogo(selected);
    setFieldErrors((current) => ({ ...current, logo: "" }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const errors: Record<string, string> = {};
    if (!values.title_pa.trim()) errors.title_pa = "Enter the company title in Pashto.";
    if (!values.title_en.trim()) errors.title_en = "Enter the company title in English.";
    if (!values.phone1.trim()) errors.phone1 = "Enter a primary phone number.";
    if (values.phone1.length > 20) errors.phone1 = "Phone number must be 20 characters or fewer.";
    if (values.phone2.length > 20) errors.phone2 = "Phone number must be 20 characters or fewer.";
    if (!values.address.trim()) errors.address = "Enter the company address.";
    if (logo && (!logo.type.startsWith("image/") || logo.size > 2 * 1024 * 1024)) {
      errors.logo = logo.size > 2 * 1024 * 1024 ? "Logo image must be 2MB or smaller." : "Choose an image file.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError("Please correct the highlighted fields."); return; }

    const payload = new FormData();
    for (const [key, value] of Object.entries(values)) payload.append(key, value);
    if (logo) payload.append("logo", logo);
    setSaving(true); setFormError(null); setSuccess(null);
    try {
      let responseData: unknown;
      if (!setting) {
        ({ data: responseData } = await api.post<unknown>("/api/settings", payload));
      } else if (logo) {
        // Laravel parses multipart uploads through POST; method spoofing reaches the existing PATCH route.
        payload.append("_method", "PATCH");
        ({ data: responseData } = await api.post<unknown>(`/api/settings/${setting.id}`, payload));
      } else {
        ({ data: responseData } = await api.patch<unknown>(`/api/settings/${setting.id}`, values));
      }
      if (!isRecord(responseData) || !isRecord(responseData.data)) throw new Error("The server saved settings but returned incomplete details.");
      const updated = parseSettings(responseData.data);
      setSetting(updated); setValues(valuesFromSettings(updated)); setLogo(null);
      const input = document.getElementById("settings-logo") as HTMLInputElement | null;
      if (input) input.value = "";
      await refreshCompanyBranding();
      setSuccess("Company settings saved successfully.");
    } catch (error: unknown) {
      const result = getValidationResult(error);
      setFieldErrors(result.fields);
      setFormError(Object.values(result.fields)[0] || result.message);
    } finally { setSaving(false); }
  }

  async function deleteSettings() {
    if (!setting || deleting) return;
    const confirmed = window.confirm(
      t("Delete company settings “{title}” and its uploaded logo? Older saved settings may become active. This cannot be undone.")
        .replace("{title}", setting.titleEn),
    );
    if (!confirmed) return;

    setDeleting(true);
    setFormError(null);
    setSuccess(null);
    try {
      const { data } = await api.delete<unknown>(`/api/settings/${setting.id}`);
      setSetting(null);
      setValues(blankValues);
      setLogo(null);
      const input = document.getElementById("settings-logo") as HTMLInputElement | null;
      if (input) input.value = "";
      await refreshCompanyBranding();

      if (!isRecord(data) || typeof data.message !== "string") {
        setFormError("Company settings were deleted, but the server response was incomplete.");
        return;
      }
      setSuccess(data.message);
    } catch (error: unknown) {
      setFormError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="settings-page" dir={direction}>
      <header className="settings-heading"><div><p className="overview-eyebrow">{t("WORKSPACE")}</p><h1>{t("Company Settings")}</h1><p>{t("Manage the organization details used throughout ERPGO.")}</p></div><button className="overview-refresh" type="button" disabled={loading} onClick={() => setLoadAttempt((value) => value + 1)}><RefreshCw size={16} />{t("Refresh")}</button></header>
      {success && <div className="settings-success" role="status"><CheckCircle2 size={17} />{t(success)}</div>}
      {loadError && <div className="settings-error" role="alert">{t(loadError)}<button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>{t("Try again")}</button></div>}
      {loading ? <div className="settings-loading" role="status"><LoaderCircle className="settings-spin" size={19} />{t("Loading company settings…")}</div> : !loadError && <form className="settings-form" onSubmit={(event) => void save(event)} noValidate>
        <div className="settings-form-heading"><div><h2>{t("Organization information")}</h2><p>{t(setting ? "Update the latest company settings record." : "No saved settings were found. Create the company settings record.")}</p></div></div>
        {formError && <p className="settings-error" role="alert">{t(formError)}</p>}
        <div className="settings-fields">
          <Field label={t("Company title in Pashto")} error={fieldErrors.title_pa ? t(fieldErrors.title_pa) : undefined}><input dir="rtl" lang="ps" required maxLength={190} value={values.title_pa} onChange={(event) => updateValue("title_pa", event.target.value)} /></Field>
          <Field label={t("Company title in English")} error={fieldErrors.title_en ? t(fieldErrors.title_en) : undefined}><input required maxLength={190} value={values.title_en} onChange={(event) => updateValue("title_en", event.target.value)} /></Field>
          <Field label={t("Primary phone")} error={fieldErrors.phone1 ? t(fieldErrors.phone1) : undefined}><input required type="tel" maxLength={20} value={values.phone1} onChange={(event) => updateValue("phone1", event.target.value)} /></Field>
          <Field label={t("Secondary phone (optional)")} error={fieldErrors.phone2 ? t(fieldErrors.phone2) : undefined}><input type="tel" maxLength={20} value={values.phone2} onChange={(event) => updateValue("phone2", event.target.value)} /></Field>
          <Field label={t("Address")} error={fieldErrors.address ? t(fieldErrors.address) : undefined} wide><textarea required rows={3} value={values.address} onChange={(event) => updateValue("address", event.target.value)} /></Field>
          <Field label={t("Bill text (optional)")} error={fieldErrors.bill_text ? t(fieldErrors.bill_text) : undefined} wide><textarea rows={3} value={values.bill_text} onChange={(event) => updateValue("bill_text", event.target.value)} /></Field>
          <div className="settings-field settings-field--wide"><span>{t("Company logo (optional)")}</span><div className="settings-logo-row">{logoPreview ? <img className="settings-logo-preview" src={logoPreview} alt={t("Company logo preview")} /> : <div className="settings-logo-placeholder"><ImagePlus size={21} /></div>}<label className="settings-logo-picker">{t("Choose image")}<input id="settings-logo" type="file" accept="image/*" onChange={handleLogo} /></label><small>{t("Image file, up to 2MB. Uploading a new logo replaces the current logo.")}</small></div>{fieldErrors.logo && <em>{t(fieldErrors.logo)}</em>}</div>
        </div>
        <footer className="settings-form-footer">
          {setting && <button className="settings-delete" type="button" disabled={saving || deleting} onClick={() => void deleteSettings()}>{deleting ? <LoaderCircle className="settings-spin" size={16} /> : <Trash2 size={16} />}{t(deleting ? "Deleting…" : "Delete company settings")}</button>}
          <button className="settings-save" type="submit" disabled={saving || deleting}>{saving ? <LoaderCircle className="settings-spin" size={16} /> : <CheckCircle2 size={16} />}{t(saving ? "Saving…" : "Save Settings")}</button>
        </footer>
      </form>}
    </div>
  );
}

function Field({ label, error, wide = false, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return <label className={`settings-field${wide ? " settings-field--wide" : ""}`}><span>{label}</span>{children}{error && <em>{error}</em>}</label>;
}
