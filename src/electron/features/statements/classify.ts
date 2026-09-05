import type { AccountKind, TransactionType } from "./types.js";

const INTEREST = [
  /\bINTEREST\s+CHARGED\b/i,
  /\bINTEREST\s+PAID\s*\/\s*EARNED\b/i,
  /\bFINANCE\s+CHARGE\b/i,
  /\bINT\s+CHARGE\b/i,
  /\bINTEREST\b/i,
];

const FEE = [
  /\bCASH\s+ADVANCE\s+FEE\b/i,
  /\bFOREIGN\s+TRANSACTION\b/i,
  /\bANNUAL\s+MEMBERSHIP\b/i,
  /\bSERVICE\s+CHARGE\b/i,
  /\bLATE\s+PAYMENT\b/i,
  /\bOVERDRAFT\b/i,
  /\bMAINTENANCE\b/i,
  /\bNSF\b/i,
  /\bFEE\b/i,
];

const PAYMENT = [
  /\bPAYMENT\s*-\s*THANK\s+YOU\b/i,
  /\bPAYMENT\s+THANK\s+YOU\b/i,
  /\bAUTOMATIC\s+PAYMENT\b/i,
  /\bONLINE\s+PAYMENT\b/i,
  /\bMOBILE\s+PAYMENT\b/i,
  /\bPAYMENT\s+RECEIVED\b/i,
  /\bACH\s+PAYMENT\b/i,
  /\bBILL\s+PAY\b/i,
  /\bAUTOPAY\b/i,
  /\bTRANSFER\b/i,
];

const P2P = [/\bZELLE\b/i, /\bVENMO\b/i, /\bPAYPAL\b/i];

const REFUND = [
  /\bCREDIT\s+ADJUSTMENT\b/i,
  /\bDISPUTE\s+CREDIT\b/i,
  /\bCHARGEBACK\b/i,
  /\bREVERSAL\b/i,
  /\bREFUND\b/i,
  /\bRETURN\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

// PAYPAL/ZELLE/VENMO are payments only when money is moving to the user's
// own accounts or bills: a credit on a card, or a debit from a bank account.
function isOwnAccountP2p(amount: number, accountKind: AccountKind): boolean {
  if (accountKind === "credit_card") return amount > 0;
  if (accountKind === "bank") return amount < 0;
  return true;
}

function isMerchantLooking(description: string): boolean {
  return /[a-z]{2,}/i.test(description);
}

export function classifyTransaction(
  description: string,
  amount: number,
  accountKind: AccountKind
): TransactionType {
  if (matchesAny(description, INTEREST)) return "interest";
  if (matchesAny(description, FEE)) return "fee";
  if (matchesAny(description, PAYMENT)) return "payment";
  if (matchesAny(description, P2P) && isOwnAccountP2p(amount, accountKind)) return "payment";
  if (matchesAny(description, REFUND)) return "refund";
  if (accountKind === "credit_card" && amount > 0 && isMerchantLooking(description)) return "refund";
  // Bank credits have no "deposit" type; treat incoming money as a payment.
  if (accountKind === "bank" && amount > 0) return "payment";
  return "purchase";
}

const TRAILING_REF = /(?:\s+(?:#\d{4,}|\d{6,}[A-Za-z]?\d*|[A-Za-z]{1,5}\d{6,}))+$/;

export function cleanDescription(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(TRAILING_REF, "").trim();
}
