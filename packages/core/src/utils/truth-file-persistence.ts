import { mergeTableMarkdownByKey } from "./governed-working-set.js";
import { LEDGER_KEY_COLUMNS, ledgerInitial } from "./ledger-schema.js";

export function isLedgerSentinel(value: string | undefined): boolean {
  const normalized = value?.trim();
  return !normalized
    || normalized === "(账本未更新)"
    || normalized === "(ledger not updated)";
}

export function isStateSentinel(value: string | undefined): boolean {
  const normalized = value?.trim();
  return !normalized
    || normalized === "(状态卡未更新)"
    || normalized === "(state card not updated)";
}

export function isHooksSentinel(value: string | undefined): boolean {
  const normalized = value?.trim();
  return !normalized
    || normalized === "(伏笔池未更新)"
    || normalized === "(hooks pool not updated)";
}

export function mergeLedgerForPersistence(
  currentLedger: string | undefined,
  incomingLedger: string | undefined,
  language: "zh" | "en",
): string | null {
  if (isLedgerSentinel(incomingLedger)) {
    return null;
  }

  const baseLedger = isLedgerSentinel(currentLedger)
    ? ledgerInitial(language)
    : currentLedger!;

  return mergeTableMarkdownByKey(baseLedger, incomingLedger!, LEDGER_KEY_COLUMNS);
}
