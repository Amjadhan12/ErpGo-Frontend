import { useEffect, useState } from "react";

type PeriodMode = "custom" | "monthly" | "yearly";

interface DatePeriodFilterProps {
  fromDate: string;
  toDate: string;
  onApply: (fromDate: string, toDate: string) => void;
  className?: string;
  applyLabel?: string;
  showReset?: boolean;
}

function periodLabel(fromDate: string, toDate: string): string {
  if (!fromDate && !toDate) return "All dates";
  return `${fromDate || "Any date"} – ${toDate || "Any date"}`;
}

export default function DatePeriodFilter({
  fromDate,
  toDate,
  onApply,
  className = "",
  applyLabel = "Apply period",
  showReset = true,
}: DatePeriodFilterProps) {
  const today = new Date();
  const [mode, setMode] = useState<PeriodMode>("custom");
  const [draftFrom, setDraftFrom] = useState(fromDate);
  const [draftTo, setDraftTo] = useState(toDate);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftFrom(fromDate);
    setDraftTo(toDate);
  }, [fromDate, toDate]);

  function apply() {
    let nextFrom = "";
    let nextTo = "";
    if (mode === "custom") {
      if (draftFrom && draftTo && draftTo < draftFrom) {
        setError("To date must be on or after the from date.");
        return;
      }
      nextFrom = draftFrom;
      nextTo = draftTo;
    } else if (mode === "monthly") {
      if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
        setError("Choose a valid month and year.");
        return;
      }
      const monthText = String(month).padStart(2, "0");
      const yearText = String(year).padStart(4, "0");
      const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      nextFrom = `${yearText}-${monthText}-01`;
      nextTo = `${yearText}-${monthText}-${String(daysInMonth[month - 1]).padStart(2, "0")}`;
    } else {
      if (!Number.isInteger(year) || year < 1 || year > 9999) {
        setError("Choose a valid year.");
        return;
      }
      const yearText = String(year).padStart(4, "0");
      nextFrom = `${yearText}-01-01`;
      nextTo = `${yearText}-12-31`;
    }
    setError(null);
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);
    onApply(nextFrom, nextTo);
  }

  function reset() {
    setMode("custom");
    setDraftFrom("");
    setDraftTo("");
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
    setError(null);
    onApply("", "");
  }

  return (
    <div className={`date-period-filter ${className}`.trim()}>
      <div className="date-period-applied"><span>Applied period</span><strong>{periodLabel(fromDate, toDate)}</strong></div>
      <label><span>Period</span><select value={mode} onChange={(event) => { setMode(event.target.value as PeriodMode); setError(null); }}><option value="custom">Custom Range</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
      {mode === "custom" ? <>
        <label><span>From date</span><input type="date" value={draftFrom} max={draftTo || undefined} onChange={(event) => setDraftFrom(event.target.value)} /></label>
        <label><span>To date</span><input type="date" value={draftTo} min={draftFrom || undefined} onChange={(event) => setDraftTo(event.target.value)} /></label>
      </> : <>
        {mode === "monthly" && <label><span>Month</span><select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2020, index, 1))}</option>)}</select></label>}
        <label><span>Year</span><input type="number" min="1" max="9999" step="1" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
      </>}
      <div className="date-period-actions">{showReset && <button type="button" className="date-period-reset" onClick={reset}>Reset</button>}<button type="button" className="date-period-apply" onClick={apply}>{applyLabel}</button></div>
      {error && <span className="date-period-error" role="alert">{error}</span>}
    </div>
  );
}
