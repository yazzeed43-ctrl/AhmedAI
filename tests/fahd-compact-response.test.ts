import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCompactResponse,
  formatCompactResponse,
} from '../lib/fahd/compact-response';

test('WAIT output exposes confidence band and non-executable readiness', () => {
  const output = formatCompactResponse({
    symbol: 'TSLA',
    decision: 'WAIT',
    confidence: 41,
    confidenceLabel: 'LOW',
    reasons: [
      'السعر فوق الحد العلوي لبولينجر؛ يوجد تمدد سعري يحتاج تأكيدًا',
    ],
    technicalBias: 'السهم محايد والسوق PUT_BIAS',
    socialBias: 'لا توجد إشارات اجتماعية حديثة',
    socialWeightingApplied: true,
    conflict: true,
    criticalLevels: ['VAH 316.12'],
    nextAction: 'راقب الصمود فوق VAH 316.12',
    executionReadiness: [
      'لا يوجد Trigger تنفيذي مؤكد',
      'لا يوجد تأكيد لآخر شمعة 5 دقائق مغلقة',
    ],
  });

  assert.match(output, /الثقة النهائية: LOW — 41%/);
  assert.match(output, /مستويات المراقبة المرجعية: VAH 316\.12/);
  assert.match(output, /جاهزية التنفيذ: WAIT/);
  assert.match(output, /isExecutable: false/);
  assert.match(output, /executableTrigger: null/);
  assert.match(output, /Social V3: مُطبّق/);
});

test('stock plan conflicts with the opposite market bias', () => {
  const compact = extractCompactResponse([
    {
      name: 'get_stock_decision',
      input: { symbol: 'TSLA' },
      output: {
        symbol: 'TSLA',
        confidence: 41,
        bias: 'WAIT',
        decision: 'WAIT',
        probabilities: {
          bullish: 35,
          bearish: 35,
          neutral: 30,
        },
        reasons: {
          bullish: ['MACD Histogram موجب'],
          bearish: [],
          risks: ['البيانات قديمة'],
        },
        levels: {
          val: 308.31,
          poc: 310.52,
          vah: 316.12,
          support: 308.31,
          resistance: 316.12,
        },
        trigger: ['CALL فقط بعد الصمود فوق VAH 316.12'],
        invalidation: ['لا يوجد سيناريو مفعل حاليًا'],
        targets: [],
        marketContext: {
          marketScore: 20,
          marketBias: 'PUT_BIAS',
          marketDecision: 'WAIT',
        },
      },
    },
  ]);

  assert.ok(compact);
  assert.equal(compact.conflict, true);
  assert.equal(compact.confidenceLabel, 'LOW');
  assert.equal(compact.decision, 'WAIT');
});

test('stock decision path explicitly declares Social V3 was not applied', () => {
  const compact = extractCompactResponse([
    {
      name: 'get_stock_decision',
      input: { symbol: 'TSLA' },
      output: {
        symbol: 'TSLA',
        confidence: 41,
        bias: 'WAIT',
        decision: 'WAIT',
        probabilities: { bullish: 35, bearish: 35, neutral: 30 },
        reasons: { bullish: [], bearish: [], risks: [] },
        levels: {
          val: null,
          poc: null,
          vah: null,
          support: null,
          resistance: null,
        },
        trigger: [],
        invalidation: [],
        targets: [],
      },
    },
    {
      name: 'get_recent_social_signals',
      input: { symbol: 'TSLA' },
      output: {
        total: 1,
        bullish: 0,
        bearish: 1,
        neutral: 0,
        highImpactCount: 0,
        earningsCount: 0,
        breakingCount: 0,
        weightedScore: -1,
        bias: 'BEARISH',
      },
    },
  ]);

  assert.ok(compact);
  assert.equal(compact.socialWeightingApplied, false);

  const output = formatCompactResponse(compact);
  assert.match(output, /Social V3: لم يُطبّق/);
});
