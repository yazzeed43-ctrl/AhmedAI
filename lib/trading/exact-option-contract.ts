import type { OptionContract } from "../tradier";

export type ExactOptionContractQuery =
  | { contractSymbol: string }
  | {
      underlying: string;
      expiration: string;
      optionType: "call" | "put";
      strike: number;
    };

export type ExactOptionContractResult =
  | {
      status: "FOUND";
      searchedContracts: number;
      nearestAvailableStrikes: [];
      availableStrikeRange: { min: number | null; max: number | null };
      contract: OptionContract;
    }
  | {
      status: "NOT_FOUND";
      searchedContracts: number;
      nearestAvailableStrikes: number[];
      availableStrikeRange: { min: number | null; max: number | null };
      contract: null;
      reason: string;
    };

export interface ParsedOccOptionSymbol {
  underlying: string;
  expiration: string;
  optionType: "call" | "put";
  strike: number;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseOccOptionSymbol(
  value: string,
): ParsedOccOptionSymbol | null {
  const match = normalizeSymbol(value).match(
    /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/,
  );
  if (!match) return null;

  const [, underlying, yy, mm, dd, side, strikeDigits] = match;
  const expiration = `20${yy}-${mm}-${dd}`;
  if (!isValidIsoDate(expiration)) return null;

  const strike = Number(strikeDigits) / 1000;
  if (!Number.isFinite(strike) || strike <= 0) return null;

  return {
    underlying,
    expiration,
    optionType: side === "C" ? "call" : "put",
    strike,
  };
}

export function findExactOptionContract(
  contracts: OptionContract[],
  query: ExactOptionContractQuery,
): ExactOptionContractResult {
  const target =
    "contractSymbol" in query
      ? parseOccOptionSymbol(query.contractSymbol)
      : {
          underlying: query.underlying.trim().toUpperCase(),
          expiration: query.expiration,
          optionType: query.optionType,
          strike: query.strike,
        };

  if (
    !target ||
    !target.underlying ||
    !isValidIsoDate(target.expiration) ||
    !Number.isFinite(target.strike) ||
    target.strike <= 0
  ) {
    return {
      status: "NOT_FOUND",
      searchedContracts: 0,
      nearestAvailableStrikes: [],
      availableStrikeRange: { min: null, max: null },
      contract: null,
      reason: "بيانات العقد المطلوبة غير صالحة؛ لم يتم تنفيذ بحث تخميني.",
    };
  }

  const availableStrikes = [
    ...new Set(
      contracts
        .filter((candidate) => {
          const parsed = parseOccOptionSymbol(candidate.symbol);
          return (
            parsed?.underlying === target.underlying &&
            candidate.expiration_date === target.expiration &&
            candidate.option_type === target.optionType
          );
        })
        .map((candidate) => candidate.strike)
        .filter(Number.isFinite),
    ),
  ];
  const availableStrikeRange =
    availableStrikes.length > 0
      ? { min: Math.min(...availableStrikes), max: Math.max(...availableStrikes) }
      : { min: null, max: null };

  const contract =
    "contractSymbol" in query
      ? contracts.find(
          (candidate) =>
            normalizeSymbol(candidate.symbol) ===
            normalizeSymbol(query.contractSymbol),
        )
      : contracts.find((candidate) => {
          const candidateUnderlying = parseOccOptionSymbol(
            candidate.symbol,
          )?.underlying;
          return (
            candidateUnderlying === target.underlying &&
            candidate.expiration_date === query.expiration &&
            candidate.option_type === query.optionType &&
            Math.abs(candidate.strike - query.strike) < 0.001
          );
        });

  if (!contract) {
    const nearestAvailableStrikes = target
      ? [
          ...new Set(
            availableStrikes,
          ),
        ]
          .map((strike) => ({
            strike,
            distance: Math.abs(strike - target.strike),
          }))
          .sort(
            (first, second) =>
              first.distance - second.distance || first.strike - second.strike,
          )
          .slice(0, 6)
          .map((item) => item.strike)
          .sort((first, second) => first - second)
      : [];
    return {
      status: "NOT_FOUND",
      searchedContracts: contracts.length,
      nearestAvailableStrikes,
      availableStrikeRange,
      contract: null,
      reason:
        nearestAvailableStrikes.length > 0
          ? `لم يُعثر على العقد المطلوب في سلسلة Tradier الكاملة. أقرب Strikes الفعلية من نفس النوع: ${nearestAvailableStrikes.join(", ")}. لم يتم استبداله بعقد آخر.`
          : "لم يُعثر على العقد المطلوب في سلسلة Tradier الكاملة، ولا توجد Strikes من النوع نفسه. لم يتم استبداله بعقد آخر.",
    };
  }

  return {
    status: "FOUND",
    searchedContracts: contracts.length,
    nearestAvailableStrikes: [],
    availableStrikeRange,
    contract,
  };
}
