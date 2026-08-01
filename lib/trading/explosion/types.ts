export type ExplosionDirection = "CALL" | "PUT" | "NEUTRAL";

export type ScoreComponentName =
  | "trend"
  | "momentum"
  | "volatility"
  | "volume"
  | "location"
  | "structureLiquidity";

export type ScoreComponentStatus =
  | "AVAILABLE"
  | "OPTIONAL_MISSING"
  | "REQUIRED_MISSING";

export interface ComponentResult {
  bullEarned: number;
  bearEarned: number;
  maximumWeight: number;
  availableMetricWeight: number;
  configuredMetricWeight: number;
  status: ScoreComponentStatus;
  reasons: string[];
  missingMetrics: string[];
}

export type ExplosionComponents = Record<
  ScoreComponentName,
  ComponentResult
>;

export type PreExecutionState =
  | "IDLE"
  | "COMPRESSION"
  | "MOMENTUM_BUILDUP"
  | "LIQUIDITY_BUILDUP"
  | "WAIT_TRIGGER"
  | "WAIT_CANDLE_CLOSE"
  | "CANDLE_CONFIRMED"
  | "MISSED_ENTRY"
  | "FAILED_BREAKOUT"
  | "CANCELLED"
  | "EXPIRED";

export type PostExecutionState =
  | "EXPANSION_ACTIVE"
  | "TARGET1"
  | "TARGET2"
  | "STOPPED"
  | "EXHAUSTED";

export type ExplosionState = PreExecutionState | PostExecutionState;

export type ExplosionDecision =
  | "WAIT_DATA"
  | "NEUTRAL"
  | "MONITOR"
  | "WAIT_TRIGGER"
  | "WAIT_CANDLE_CLOSE"
  | "WAIT_CONTRACT"
  | "MISSED_ENTRY"
  | "EXECUTABLE"
  | "CANCELLED"
  | "FAILED_BREAKOUT"
  | "EXPIRED"
  | "STOPPED"
  | "EXHAUSTED"
  | "TARGET1"
  | "TARGET2";

export interface CandleSnapshot {
  openTime: string;
  closed: boolean;
}

export interface TriggerTouchSnapshot {
  touchedAt: string;
  touchedBarTime: string;
  firstEligibleConfirmationBarTime: string | null;
  lastEvaluatedBarTime: string | null;
  confirmationBarsEvaluated: number;
}

export interface ExplosionEvent {
  type: "TRIGGER_TOUCHED";
  occurredAt: string;
  barTime: string;
}

export interface PreExecutionEvaluation {
  state: PreExecutionState;
  touchSnapshot: TriggerTouchSnapshot | null;
  events: ExplosionEvent[];
}

export interface PreExecutionInput {
  now: string;
  candle: CandleSnapshot;
  touchSnapshot: TriggerTouchSnapshot | null;
  requiredDataMissing: boolean;
  invalidationHit: boolean;
  triggerTouched: boolean;
  candleClosedBeyondTrigger: boolean;
  entryNotExtended: boolean;
  breakoutAttemptWasValid: boolean;
}

export interface PostExecutionInput {
  stopHit: boolean;
  target1Hit: boolean;
  target2Hit: boolean;
  exhaustionConfirmed: boolean;
}

export type MarketDataFreshness = "FRESH" | "STALE" | "MISSING";
export type CalendarDataStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

export interface MandatoryGateInput {
  direction: ExplosionDirection;
  selectedExplosionScore: number | null;
  contractQuality: number | null;
  state: ExplosionState;
  breakoutVolumeConfirmed: boolean;
  underlyingDataStatus: MarketDataFreshness;
  contractDataStatus: MarketDataFreshness;
  contractLiquid: boolean;
  economicCalendarStatus: CalendarDataStatus;
  economicGateAllowsEntry: boolean;
  noInvalidation: boolean;
  signalExpired: boolean;
  entryNotExtended: boolean;
}

export interface MandatoryGateResult {
  directionResolved: boolean;
  scorePassed: boolean;
  contractQualityPassed: boolean;
  candleClosedBeyondTrigger: boolean;
  breakoutVolumeConfirmed: boolean;
  underlyingDataFresh: boolean;
  contractDataFresh: boolean;
  contractLiquid: boolean;
  economicDataComplete: boolean;
  economicGateAllowsEntry: boolean;
  noInvalidation: boolean;
  notExpired: boolean;
  entryNotExtended: boolean;
  allPassed: boolean;
}

export interface ScoreEvaluation {
  bullScore: number | null;
  bearScore: number | null;
  scoreCoverage: number;
  requiredDataMissing: boolean;
  reasons: string[];
  blockers: string[];
}

export interface DirectionEvaluation {
  direction: ExplosionDirection;
  selectedExplosionScore: number | null;
  scoreEdge: number | null;
}

export interface ExplosionEngineInput {
  components: ExplosionComponents;
  preExecution: PreExecutionInput;
  currentState?: ExplosionState;
  postExecution?: PostExecutionInput;
  contractQuality: number | null;
  breakoutVolumeConfirmed: boolean;
  underlyingDataStatus: MarketDataFreshness;
  contractDataStatus: MarketDataFreshness;
  contractLiquid: boolean;
  economicCalendarStatus: CalendarDataStatus;
  economicGateAllowsEntry: boolean;
  executableTrigger: number | null;
  invalidationLevel: number | null;
  setupId: string | null;
}

export interface ExplosionEngineResult {
  bullScore: number | null;
  bearScore: number | null;
  selectedExplosionScore: number | null;
  scoreEdge: number | null;
  scoreCoverage: number;
  direction: ExplosionDirection;
  state: ExplosionState;
  decision: ExplosionDecision;
  isExecutable: boolean;
  executableTrigger: number | null;
  invalidationLevel: number | null;
  setupId: string | null;
  touchSnapshot: TriggerTouchSnapshot | null;
  events: ExplosionEvent[];
  contractQuality: number | null;
  components: ExplosionComponents;
  gates: MandatoryGateResult;
  blockers: string[];
  reasons: string[];
}
