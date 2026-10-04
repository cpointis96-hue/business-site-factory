export const STANDARD_AUDIT_PROFILE = Object.freeze({
  maxPages: 50,
  maxBytes: 25 * 1024 * 1024,
  timeoutMs: 180000,
});

export const STANDARD_AUDIT_BUDGET = Object.freeze({
  hardLimit: 0.5,
  currency: 'USD',
  endpointCosts: Object.freeze({
    serpMaps: 0.01,
    serpOrganicLiveAdvanced: 0.01,
    businessListings: 0.005,
    onPage: 0.01,
    keywordSearchVolume: 0.005,
    keywordIdeas: 0.02,
    keywordOverview: 0.015,
    serpCompetitors: 0.02,
    serpLocalFinder: 0.01,
  }),
});

export function resolveAuditProfile(profile = {}) {
  return { ...STANDARD_AUDIT_PROFILE, ...profile };
}

export function resolveAuditBudget(budget = {}) {
  const requestedLimit = typeof budget.hardLimit === 'number' && Number.isFinite(budget.hardLimit)
    ? Math.max(0, budget.hardLimit)
    : STANDARD_AUDIT_BUDGET.hardLimit;
  return {
    ...STANDARD_AUDIT_BUDGET,
    ...budget,
    hardLimit: Math.min(STANDARD_AUDIT_BUDGET.hardLimit, requestedLimit),
    endpointCosts: { ...STANDARD_AUDIT_BUDGET.endpointCosts, ...(budget.endpointCosts ?? {}) },
  };
}
