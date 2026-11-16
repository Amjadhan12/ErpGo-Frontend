export type FinancialKind = "balance" | "receivable" | "payable" | "income" | "expense";

export function financialValueClass(amount: number, kind: FinancialKind): string {
  if (amount === 0) return "financial-value--neutral";
  if (kind === "expense") return amount > 0 ? "financial-value--payable" : "financial-value--positive";
  if (amount < 0) return "financial-value--negative";
  if (kind === "receivable") return "financial-value--receivable";
  if (kind === "payable") return "financial-value--payable";
  return "financial-value--positive";
}

export function financialChartColor(amount: number, kind: FinancialKind): string {
  const tone = financialValueClass(amount, kind);
  if (tone === "financial-value--positive") return "#15803d";
  if (tone === "financial-value--negative") return "#b91c1c";
  if (tone === "financial-value--receivable") return "#0369a1";
  if (tone === "financial-value--payable") return "#c2410c";
  return "#64748b";
}
