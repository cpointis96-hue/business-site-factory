function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function renderSeoAuditReport(audit) {
  if (!audit || typeof audit !== 'object' || !audit.summary || !Array.isArray(audit.findings)) throw new TypeError('Audit invalide.');
  const findings = audit.findings.length
    ? `<ol>${audit.findings.map(item => `<li><strong>${escapeHtml(item.code)}</strong><p>${escapeHtml(item.detail)}</p><small>${escapeHtml(item.evidence.url)} · ${escapeHtml(item.evidence.observedAt)} · ${escapeHtml(item.evidence.ruleVersion)}</small></li>`).join('')}</ol>`
    : '<p>Aucun finding dans le périmètre observé.</p>';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rapport d’audit SEO</title><style>body{font:16px/1.55 system-ui;max-width:860px;margin:auto;padding:24px;color:#20211f;background:#f5f5f2}header{background:#173024;color:#eef4ec;padding:32px}header small{color:#b8ce98}section{border-top:1px solid #d9dbd5;padding:24px 0}li{margin:16px 0}li p{margin:4px 0}small{color:#5a635c}</style></head><body><header><small>RAPPORT D’AUDIT SEO · ${escapeHtml(audit.status)}</small><h1>${escapeHtml(audit.target)}</h1><div>Observation : ${escapeHtml(audit.observedAt)}</div></header><main><section><h2>Périmètre</h2><p>${escapeHtml(audit.summary.pagesAnalyzed)} page(s) analysée(s), ${escapeHtml(audit.summary.pagesSkipped)} ignorée(s). Règles : ${escapeHtml(audit.ruleVersion)}.</p></section><section><h2>Findings observés</h2>${findings}</section></main></body></html>`;
}
