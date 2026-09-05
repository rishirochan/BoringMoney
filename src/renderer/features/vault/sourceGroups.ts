export function sourceKey(document: DocumentRecord): string {
  if (document.account) return document.account;
  const { summary } = document;
  if (!summary?.institution && !summary?.accountLast4) return document.id;
  return [summary.institution, summary.accountKind, summary.accountLast4].filter(Boolean).join(":");
}

export function sourceLabel(document: DocumentRecord): string {
  if (document.account) return document.account;
  const { summary } = document;
  const account = summary?.institution ??
    (summary?.accountKind === "bank"
      ? "Bank account"
      : summary?.accountKind === "credit_card"
        ? "Credit card"
        : null);
  return account
    ? `${account}${summary?.accountLast4 ? ` •${summary.accountLast4}` : ""}`
    : document.fileName.replace(/\.csv$/i, "");
}
