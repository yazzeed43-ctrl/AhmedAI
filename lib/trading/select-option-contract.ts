// lib/trading/select-option-contract.ts
//
// الخطوة (ج): selectOptionContract()
// غلاف فوق scanTradierOpportunities / getFullOptionsChain / findExactOptionContract
// - لا يعيد بناء أي منطق اختيار موجود أصلاً.
// - لا يختار Strike أو Expiration قريب بصمت أبداً.
// - AUTO / strike فقط  → scanTradierOpportunities (يحافظ على ترتيب الماسح)
// - expiration فقط     → getFullOptionsChain + ترتيب سيولة/سبريد/OI/حجم
// - expiration + strike → getFullOptionsChain + findExactOptionContract (تطابق صارم)

import { scanTradierOpportunities } from "./tradier-scanner";

import {
  getFullOptionsChain,
  type OptionContract,
} from "../tradier";

import {
  findExactOptionContract,
  isValidIsoDate,
} from "./exact-option-contract";

// ---------- الأنواع ----------

export type OptionDirection = "CALL" | "PUT";

export type SelectOptionContractInput = {
  symbol: string;
  direction: OptionDirection;

  // اختيار يدوي اختياري
  strike?: number;
  expiration?: string;

  // للاختبار فقط
  deps?: {
    scanOpportunities?: typeof scanTradierOpportunities;
    fetchFullChain?: typeof getFullOptionsChain;
  };
};

export type ContractSource = "SCANNER" | "FULL_CHAIN";

// نوع نتيجة الماسح مشتق مباشرة من الدالة الحقيقية — لا نسخ يدوي (Single Source of Truth)
type ScanResult = Awaited<ReturnType<typeof scanTradierOpportunities>>;
type ScannerOpportunity = ScanResult["opportunities"][number];

export interface SelectedOptionContract {
  source: ContractSource;
  symbol: string;
  direction: OptionDirection;
  contractSymbol: string;
  expiration: string;
  strike: number;
  bid: number;
  ask: number;
  last: number | null;
  volume: number;
  openInterest: number;
  spreadPercent: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  // الكائن الأصلي كامل بدون أي فقدان بيانات — للمستهلكين اللي يحتاجون
  // حقول خاصة بمصدر معيّن (score/optionBrain من SCANNER أو liquidity_quality من FULL_CHAIN)
  raw: ScannerOpportunity | OptionContract;
}

export interface ExactContractNotFoundDetails {
  reason: string;
  nearestAvailableStrikes: number[];
  availableStrikeRange: { min: number | null; max: number | null };
}

export type SelectOptionContractResult =
  | {
      status: "READY";
      selectionMode: "AUTO" | "EXACT";
      contract: SelectedOptionContract;
      warnings: string[];
    }
  | {
      status: "WAIT_DATA";
      reason:
        | "INVALID_SYMBOL"
        | "INVALID_STRIKE"
        | "INVALID_EXPIRATION"
        | "SCAN_FAILED"
        | "PARTIAL_DATA"
        | "NO_OPPORTUNITIES"
        | "EXACT_CONTRACT_NOT_FOUND"
        | "CHAIN_FETCH_FAILED";
      warnings: string[];
      // فقط عند EXACT_CONTRACT_NOT_FOUND القادم من findExactOptionContract
      details?: ExactContractNotFoundDetails;
    };

// TODO: استخراج تحقق موحد للرموز (نواة مشتركة) واستخدامه هنا وفي getFullOptionsChain
// بدل تكرار نفس الـ Regex بملفين. لا توجد حالياً دالة normalizeSymbol()/isValidSymbol()
// مُصدّرة يمكن الاستيراد منها مباشرة.
const SYMBOL_REGEX = /^[A-Z0-9.]{1,12}$/;

// ---------- محولات (Mappers) — بدون تكرار بناء الكائن أكثر من مرة ----------

function toSelectedFromChainContract(
  best: OptionContract,
  normalizedSymbol: string,
  direction: OptionDirection,
): SelectedOptionContract {
  return {
    source: "FULL_CHAIN",
    symbol: normalizedSymbol,
    direction,
    contractSymbol: best.symbol,
    expiration: best.expiration_date,
    strike: best.strike,
    bid: best.bid,
    ask: best.ask,
    last: best.last,
    volume: best.volume,
    openInterest: best.open_interest,
    spreadPercent: best.spread_pct,
    delta: best.greeks?.delta ?? null,
    gamma: best.greeks?.gamma ?? null,
    theta: best.greeks?.theta ?? null,
    vega: best.greeks?.vega ?? null,
    impliedVolatility: best.greeks?.mid_iv ?? null,
    raw: best,
  };
}

function toSelectedFromScannerOpportunity(
  best: ScannerOpportunity,
): SelectedOptionContract {
  return {
    source: "SCANNER",
    symbol: best.underlying,
    direction: best.direction,
    contractSymbol: best.contractSymbol,
    expiration: best.expiration,
    strike: best.strike,
    bid: best.bid,
    ask: best.ask,
    last: best.last,
    volume: best.volume,
    openInterest: best.openInterest,
    spreadPercent: best.spreadPercent,
    delta: best.delta,
    gamma: best.gamma,
    theta: best.theta,
    vega: best.vega,
    impliedVolatility: best.impliedVolatility,
    raw: best,
  };
}

// ---------- الدالة الرئيسية ----------

export async function selectOptionContract(
  input: SelectOptionContractInput,
): Promise<SelectOptionContractResult> {
  const warnings: string[] = [];

  // 1) التحقق من الرمز
  const normalizedSymbol = input.symbol.trim().toUpperCase();
  if (!SYMBOL_REGEX.test(normalizedSymbol)) {
    return { status: "WAIT_DATA", reason: "INVALID_SYMBOL", warnings };
  }

  // 2) التحقق من strike إن وُجد
  if (input.strike !== undefined) {
    if (!Number.isFinite(input.strike) || input.strike <= 0) {
      return { status: "WAIT_DATA", reason: "INVALID_STRIKE", warnings };
    }
  }

  // 3) التحقق من expiration إن وُجد (نستخدم النواة الموجودة، لا نكرر Regex التاريخ)
  if (input.expiration !== undefined && !isValidIsoDate(input.expiration)) {
    return { status: "WAIT_DATA", reason: "INVALID_EXPIRATION", warnings };
  }

  const selectionMode: "AUTO" | "EXACT" =
    input.strike !== undefined || input.expiration !== undefined
      ? "EXACT"
      : "AUTO";

  // ---------- المسار: expiration محدد → FULL_CHAIN ----------
  if (input.expiration !== undefined) {
    const fetchChain = input.deps?.fetchFullChain ?? getFullOptionsChain;
    let chain: OptionContract[];

    try {
      chain = await fetchChain(normalizedSymbol, input.expiration);
    } catch {
      return { status: "WAIT_DATA", reason: "CHAIN_FETCH_FAILED", warnings };
    }

    const wantedType = input.direction === "CALL" ? "call" : "put";

    // ---- expiration + strike → نواة findExactOptionContract الصارمة ----
    if (input.strike !== undefined) {
      const exact = findExactOptionContract(chain, {
        underlying: normalizedSymbol,
        expiration: input.expiration,
        optionType: wantedType,
        strike: input.strike,
      });

      if (exact.status === "NOT_FOUND") {
        return {
          status: "WAIT_DATA",
          reason: "EXACT_CONTRACT_NOT_FOUND",
          warnings: [],
          details: {
            reason: exact.reason,
            nearestAvailableStrikes: exact.nearestAvailableStrikes,
            availableStrikeRange: exact.availableStrikeRange,
          },
        };
      }

      const contract = toSelectedFromChainContract(
        exact.contract,
        normalizedSymbol,
        input.direction,
      );

      return { status: "READY", selectionMode: "EXACT", contract, warnings };
    }

    // ---- expiration فقط → ترتيب سيولة/سبريد/OI/حجم (بدون ATM/Delta، بدون منافسة الماسح) ----
    let candidates = chain.filter((c) => c.option_type === wantedType);

    // استبعاد العقود ذات bid/ask غير الصالحين
    candidates = candidates.filter(
      (c) => c.bid > 0 && c.ask > 0 && c.ask >= c.bid,
    );

    if (candidates.length === 0) {
      return {
        status: "WAIT_DATA",
        reason: "EXACT_CONTRACT_NOT_FOUND",
        warnings,
      };
    }

    const liquidityRank: Record<OptionContract["liquidity_quality"], number> = {
      "جيد": 0,
      "متوسط": 1,
      "ضعيف - احذر": 2,
    };

    const sorted = [...candidates].sort((a, b) => {
      const liqDiff =
        liquidityRank[a.liquidity_quality] - liquidityRank[b.liquidity_quality];
      if (liqDiff !== 0) return liqDiff;

      const aSpread = a.spread_pct ?? Number.POSITIVE_INFINITY;
      const bSpread = b.spread_pct ?? Number.POSITIVE_INFINITY;
      if (aSpread !== bSpread) return aSpread - bSpread;

      if (a.open_interest !== b.open_interest) {
        return b.open_interest - a.open_interest;
      }
      return b.volume - a.volume;
    });

    // sorted بالكامل متاحة مستقبلاً لعرض Top N بدون إعادة فرز
    const best = sorted[0];

    const contract = toSelectedFromChainContract(
      best,
      normalizedSymbol,
      input.direction,
    );

    return { status: "READY", selectionMode: "EXACT", contract, warnings };
  }

  // ---------- المسار: AUTO أو strike فقط → SCANNER ----------
  const scan = input.deps?.scanOpportunities ?? scanTradierOpportunities;

  let result: ScanResult;
  try {
    result = await scan({ symbols: [normalizedSymbol] });
  } catch {
    return { status: "WAIT_DATA", reason: "SCAN_FAILED", warnings };
  }

  if (result.dataStatus === "DATA_PROVIDER_ERROR") {
    return { status: "WAIT_DATA", reason: "SCAN_FAILED", warnings };
  }

  if (result.dataStatus === "PARTIAL_DATA") {
    return { status: "WAIT_DATA", reason: "PARTIAL_DATA", warnings };
  }

  if (result.outcome !== "OPPORTUNITIES_FOUND") {
    return { status: "WAIT_DATA", reason: "NO_OPPORTUNITIES", warnings };
  }

  let matches = result.opportunities.filter(
    (o) => o.direction === input.direction,
  );

  if (input.strike !== undefined) {
    matches = matches.filter((o) => o.strike === input.strike);
  }

  if (matches.length === 0) {
    return {
      status: "WAIT_DATA",
      reason:
        input.strike !== undefined
          ? "EXACT_CONTRACT_NOT_FOUND"
          : "NO_OPPORTUNITIES",
      warnings,
    };
  }

  // نثق بترتيب opportunities القادم من الماسح (rankOpportunities داخل scanTradierOpportunities)
  // .filter() يحافظ على هذا الترتيب، فلا حاجة لإعادة الفرز بـ rank هنا
  const best = matches[0];

  const contract = toSelectedFromScannerOpportunity(best);

  return {
    status: "READY",
    selectionMode,
    contract,
    warnings: [...warnings, ...best.warnings],
  };
}
