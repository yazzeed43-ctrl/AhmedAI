import {
  DEFAULT_EXPLOSION_CONFIG,
  type ExplosionEngineConfig,
  validateExplosionConfig,
} from "./config";
import { resolveExplosionDirection } from "./direction-resolver";
import {
  deriveExplosionDecision,
  evaluateMandatoryGates,
  gateBlockers,
} from "./mandatory-gates";
import { evaluateExplosionScores } from "./score-coverage";
import {
  evaluatePostExecutionState,
  evaluatePreExecutionState,
} from "./state-machine";
import type {
  ExplosionEngineInput,
  ExplosionEngineResult,
  MandatoryGateInput,
  PostExecutionState,
} from "./types";

const POST_EXECUTION_STATES = new Set<PostExecutionState>([
  "EXPANSION_ACTIVE",
  "TARGET1",
  "TARGET2",
  "STOPPED",
  "EXHAUSTED",
]);

export function evaluateExplosionEngine(
  input: ExplosionEngineInput,
  config: ExplosionEngineConfig = DEFAULT_EXPLOSION_CONFIG,
): ExplosionEngineResult {
  validateExplosionConfig(config);

  const scores = evaluateExplosionScores(
    input.components,
    config.minimumScoreCoverage,
  );
  const direction = resolveExplosionDirection(
    scores.bullScore,
    scores.bearScore,
    config.minimumScore,
    config.minimumEdge,
  );

  const isPostExecution =
    input.currentState !== undefined &&
    POST_EXECUTION_STATES.has(input.currentState as PostExecutionState);

  const preExecution = isPostExecution
    ? null
    : evaluatePreExecutionState(
        {
          ...input.preExecution,
          requiredDataMissing:
            input.preExecution.requiredDataMissing || scores.requiredDataMissing,
        },
        config,
      );

  const requiredDataMissing =
    scores.requiredDataMissing || input.preExecution.requiredDataMissing;

  const state = isPostExecution
    ? evaluatePostExecutionState(
        input.postExecution ?? {
          stopHit: false,
          target1Hit: false,
          target2Hit: false,
          exhaustionConfirmed: false,
        },
        config,
      )
    : preExecution!.state;

  const gateInput: MandatoryGateInput = {
    direction: direction.direction,
    selectedExplosionScore: direction.selectedExplosionScore,
    contractQuality: input.contractQuality,
    state,
    breakoutVolumeConfirmed: input.breakoutVolumeConfirmed,
    underlyingDataStatus: input.underlyingDataStatus,
    contractDataStatus: input.contractDataStatus,
    contractLiquid: input.contractLiquid,
    economicCalendarStatus: input.economicCalendarStatus,
    economicGateAllowsEntry: input.economicGateAllowsEntry,
    noInvalidation: !input.preExecution.invalidationHit,
    signalExpired: state === "EXPIRED",
    entryNotExtended: input.preExecution.entryNotExtended,
  };
  const gates = evaluateMandatoryGates(gateInput, config);
  const decision = requiredDataMissing
    ? "WAIT_DATA"
    : deriveExplosionDecision(gateInput, gates);
  const isExecutable = decision === "EXECUTABLE" && gates.allPassed;

  return {
    bullScore: scores.bullScore,
    bearScore: scores.bearScore,
    selectedExplosionScore: direction.selectedExplosionScore,
    scoreEdge: direction.scoreEdge,
    scoreCoverage: scores.scoreCoverage,
    direction: direction.direction,
    state,
    decision,
    isExecutable,
    executableTrigger: isExecutable ? input.executableTrigger : null,
    invalidationLevel: input.invalidationLevel,
    setupId: input.setupId,
    touchSnapshot: preExecution?.touchSnapshot ?? input.preExecution.touchSnapshot,
    events: preExecution?.events ?? [],
    contractQuality: input.contractQuality,
    components: input.components,
    gates,
    blockers: [...scores.blockers, ...gateBlockers(gates)],
    reasons: scores.reasons,
  };
}
