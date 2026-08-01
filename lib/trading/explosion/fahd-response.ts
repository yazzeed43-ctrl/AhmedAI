interface ExplosionFahdDiagnostic {
  mode?: string;
  spxPrice?: {
    price?: number;
    priceSource?: string;
    freshness?: string;
    ageSeconds?: number | null;
  };
  technicalProxy?: { symbol?: string; timeframes?: readonly string[] };
  engine?: {
    bullScore?: number | null;
    bearScore?: number | null;
    selectedExplosionScore?: number | null;
    scoreEdge?: number | null;
    scoreCoverage?: number | null;
    direction?: string;
    state?: string;
    decision?: string;
    blockers?: string[];
  };
  integration?: {
    scanStatus?: string;
    selectedContract?: {
      contractSymbol?: string;
      direction?: string;
      strike?: number;
      expiration?: string;
      midpoint?: number;
      contractScore?: number;
      finalScore?: number;
    } | null;
    selectedContractQuote?: {
      bid?: number;
      ask?: number;
      midpoint?: number;
      freshness?: string;
      ageSeconds?: number | null;
    } | null;
    contractQuoteFreshness?: string;
    economicGate?: {
      dataStatus?: string;
      blockNewTrades?: boolean;
      blockCause?: string;
      reason?: string;
    };
    triggerPlan?: { plans?: unknown[] } | null;
  };
}

const BLOCKER_LABELS: Record<string, string> = {
  "Direction is not resolved": "لم يُحسم اتجاه CALL أو PUT",
  "Explosion score is below the executable threshold": "درجة الانفجار أقل من حد التنفيذ",
  "Contract quality is below the required threshold": "جودة العقد أقل من الحد المطلوب",
  "A closed candle has not confirmed the trigger": "لا توجد شمعة 5 دقائق مغلقة تؤكد التفعيل",
  "Breakout volume is not confirmed": "حجم الاختراق غير مؤكد",
  "Underlying data is not fresh": "بيانات SPX غير لحظية",
  "Contract data is not fresh": "بيانات العقد غير لحظية",
  "The option contract is not liquid": "سيولة العقد غير كافية",
  "Economic calendar data is incomplete": "بيانات التقويم الاقتصادي غير مكتملة",
  "The economic gate blocks entry": "البوابة الاقتصادية تمنع الدخول",
};

function number(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits).replace(/\.00$/, "")
    : "غير متاح";
}

export function isExplosionDiagnosticRequest(message: string): boolean {
  const normalized = message.trim();
  const mentionsSpx = /\bSPXW?\b|سباكس|إس\s*بي\s*إكس/i.test(normalized);
  const requestsExplosion =
    /انفجار|زخم|سيولة|ضغط\s*سعري|تحرر\s*سعري|explosion|momentum|liquidity/i.test(
      normalized,
    );
  return mentionsSpx && requestsExplosion;
}

export function formatExplosionDiagnostic(
  result: ExplosionFahdDiagnostic,
): string {
  const engine = result.engine ?? {};
  const integration = result.integration ?? {};
  const contract = integration.selectedContract;
  const quote = integration.selectedContractQuote;
  const gate = integration.economicGate;
  const coverage =
    typeof engine.scoreCoverage === "number"
      ? `${Math.round(engine.scoreCoverage * 100)}%`
      : "غير متاحة";
  const blockers = (engine.blockers ?? []).slice(0, 6);

  const lines = [
    "محرك زخم وسيولة وانفجار SPXW",
    "تشخيص ومراقبة فقط — ليست توصية دخول",
    "",
    `القرار: ${engine.decision ?? "WAIT_DATA"}`,
    `الحالة: ${engine.state ?? "WAIT_DATA"}`,
    `الاتجاه: ${engine.direction ?? "NEUTRAL"}`,
    `درجة CALL: ${number(engine.bullScore)} | درجة PUT: ${number(engine.bearScore)}`,
    `الدرجة المختارة: ${number(engine.selectedExplosionScore)} | فارق الاتجاه: ${number(engine.scoreEdge)}`,
    `تغطية بيانات المؤشر: ${coverage}`,
    "",
    "بيانات الأصل",
    `SPX: ${number(result.spxPrice?.price)} | المصدر: ${result.spxPrice?.priceSource ?? "غير متاح"}`,
    `الحداثة: ${result.spxPrice?.freshness ?? "unknown"} | العمر: ${number(result.spxPrice?.ageSeconds, 0)} ثانية`,
    `التحليل الفني والحجم: ${result.technicalProxy?.symbol ?? "SPY"} (${result.technicalProxy?.timeframes?.join("، ") ?? "5min، 15min"}) كبديل معلن لـSPX`,
    "",
    "العقد المختار",
  ];

  if (contract) {
    lines.push(
      `${contract.contractSymbol ?? "رمز غير متاح"} | ${contract.direction ?? "-"}`,
      `Strike ${number(contract.strike)} | Exp ${contract.expiration ?? "غير متاح"} | Mid ${number(contract.midpoint)}`,
      `جودة العقد ${number(contract.contractScore)} | finalScore ${number(contract.finalScore)}`,
      quote
        ? `عرض/طلب ${number(quote.bid)}/${number(quote.ask)} | Mid ${number(quote.midpoint)} | الحداثة ${quote.freshness ?? integration.contractQuoteFreshness ?? "unknown"} | العمر ${number(quote.ageSeconds, 0)} ثانية`
        : "لا يوجد Quote مستقل صالح وحديث للعقد؛ التنفيذ مغلق.",
    );
  } else {
    lines.push("لا يوجد عقد SPXW مطابق للاتجاه والفلاتر الحالية.");
  }

  lines.push(
    "",
    "التقويم الاقتصادي",
    `الحالة: ${gate?.dataStatus ?? "UNAVAILABLE"} | منع صفقات جديدة: ${gate?.blockNewTrades ? "نعم" : "لا"} | السبب: ${gate?.blockCause ?? "غير متاح"}`,
  );
  if (gate?.reason) lines.push(gate.reason);

  lines.push("", "جاهزية التنفيذ");
  if (blockers.length > 0) {
    for (const blocker of blockers) {
      lines.push(`- ${BLOCKER_LABELS[blocker] ?? blocker}`);
    }
  } else {
    lines.push("- لا توجد موانع تشخيصية، لكن هذا المسار لا ينفذ صفقات.");
  }

  lines.push(
    "",
    "النتيجة: غير قابل للتنفيذ من هذا المسار.",
    "للدخول يلزم سعر حي، عقد حي وسائل، تقويم مكتمل، ثم إغلاق شمعة 5 دقائق يؤكد التفعيل.",
  );

  return lines.join("\n");
}
