function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function statusDot(status) {
  const tone = status === 'SUCCEEDED' ? 'good' : status === 'BLOCKED' ? 'bad' : 'warn';
  return `<span class="status-dot status-${tone}" role="img" aria-label="${escapeHtml(status)}" title="${escapeHtml(status)}"></span>`;
}

function metric(value) {
  if (value === null || value === undefined || value === '') return 'Non disponible';
  if (typeof value === 'number' && Number.isFinite(value)) return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

function cell(value, className = '') { return `<td class="${className}">${escapeHtml(value)}</td>`; }

function reportStyles() {
  return `:root{color-scheme:light;--deep:#101711;--ink:#18201a;--muted:#5d675f;--paper:#f4f5f0;--surface:#fff;--line:#d8ddd4;--moss:#5c733f;--moss-soft:#dfe9d5;--orange:#a66820;--red:#9a3d35}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--moss);overflow-wrap:anywhere}main{max-width:1120px;margin:0 auto;padding:32px clamp(18px,5vw,72px) 72px}.report-header{background:var(--deep);color:#eef4ec;padding:clamp(24px,5vw,54px);border-radius:2px}.report-kicker{display:flex;align-items:center;gap:10px;color:#b8ce98;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.report-header h1{max-width:760px;margin:18px 0 8px;font-size:clamp(32px,6vw,72px);line-height:.98;letter-spacing:-.055em}.report-header p{margin:0;color:#c5d0c3}.status-dot{display:inline-block;width:10px;height:10px;flex:0 0 10px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 3px rgba(166,104,32,.18)}.status-good{background:#9bc77b;box-shadow:0 0 0 3px rgba(155,199,123,.2)}.status-bad{background:#ec8b7b;box-shadow:0 0 0 3px rgba(236,139,123,.2)}.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:24px 0 8px}.summary-grid div{background:var(--surface);padding:18px 20px}.summary-grid span{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}.summary-grid strong{font-size:22px;letter-spacing:-.02em}section{border-top:1px solid var(--line);padding:30px 0}section h2{margin:0 0 14px;font-size:22px;letter-spacing:-.02em}section p{max-width:780px}.section-intro{color:var(--muted)}ul{padding-left:20px}li{margin:8px 0;overflow-wrap:anywhere}li .status-dot{margin-right:8px;vertical-align:middle}li strong{margin-right:10px}li span:not(.status-dot){color:var(--muted)}.empty-state{border:1px dashed #b8c2b5;background:#fafbf8;color:var(--muted);padding:18px 20px}.table-wrap{width:100%;overflow-x:auto;border:1px solid var(--line);background:var(--surface)}table{width:100%;border-collapse:collapse;min-width:680px}th,td{text-align:left;padding:13px 14px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#edf1e9;color:#43503f;font-size:12px;font-weight:650;white-space:nowrap}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#fafcf8}.keyword{font-weight:650;color:var(--deep)}:focus-visible{outline:3px solid #9bc77b;outline-offset:3px}@media(max-width:700px){main{padding:18px 14px 48px}.report-header{padding:24px 20px}.report-header h1{font-size:clamp(34px,13vw,52px)}.summary-grid{grid-template-columns:1fr}.summary-grid div{padding:14px 16px}section{padding:24px 0}section h2{font-size:20px}.table-wrap{border-left:0;border-right:0;margin-left:-14px;width:calc(100% + 28px)}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;
}

function renderKeywordTable(items) {
  if (!items.length) return '<div class="empty-state">Aucune opportunité de marché suffisamment liée à l’activité observée.</div>';
  const rows = items.map(item => `<tr>${cell(item.keyword, 'keyword')}${cell(item.intent ?? 'Non disponible')}${cell(item.scope === 'local-query' ? 'Requête locale' : 'Marché pays')}${cell(metric(item.searchVolume))}${cell(metric(item.cpc))}${cell(item.evidence === 'category-and-locality' ? 'Catégorie + localité' : 'Catégorie observée')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Mot-clé</th><th scope="col">Intention</th><th scope="col">Portée</th><th scope="col">Volume</th><th scope="col">CPC</th><th scope="col">Fondement</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderCompetitorTable(items) {
  if (!items.length) return '<div class="empty-state">Aucune piste concurrentielle corroborée dans les résultats observés.</div>';
  const rows = items.map(item => `<tr>${cell(item.title ?? item.domain, 'keyword')}${cell(item.scope === 'local-serp' ? 'Local observé' : 'SEO pays')}${cell(item.domain ?? 'Non disponible')}${cell(item.scope === 'local-serp' ? 'Résultat Local Finder' : 'Piste à corroborer')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Concurrent</th><th scope="col">Portée</th><th scope="col">Site</th><th scope="col">Fondement</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Design Read: audit local opérateur, ENERGY 1 / RHYTHM 2 / MOTION 1.
// Le header concentre la décision, les tableaux servent la comparaison, le vert mousse signale la preuve sans effet décoratif.
export function renderPublicAuditReport(result, kind) {
  const title = kind === 'gmb' ? 'Rapport GMB' : 'Rapport final SEO et concurrence';
  const displayStatus = kind === 'gmb' ? result.stages.find(item => item.id === 'gmb-audit')?.status ?? result.status : result.status;
  const gmbCandidates = result.modules.gmb?.candidates ?? [];
  const selectedEstablishment = result.modules.establishment?.selected ?? null;
  const selectedIdentity = selectedEstablishment ? `<p>Établissement sélectionné : ${escapeHtml(selectedEstablishment.name)}${selectedEstablishment.address ? ` · ${escapeHtml(selectedEstablishment.address)}` : ''}.</p>` : '';
  const keywords = result.modules.keywords?.ideas ?? [];
  const rejectedKeywords = result.modules.keywords?.rejected ?? [];
  const competitors = result.modules.keywords?.competitors ?? [];
  const researchPlan = result.modules.keywords?.researchPlan ?? null;
  const stages = result.stages.map(item => `<li>${statusDot(item.status)}<strong>${escapeHtml(item.id)}</strong>${item.cause ? `<span>${escapeHtml(item.cause)}</span>` : ''}</li>`).join('');
  const evidence = result.evidence.map(item => `<li><span>${escapeHtml(item.provider)}</span> · <a href="${escapeHtml(item.canonicalUrl)}">${escapeHtml(item.canonicalUrl)}</a></li>`).join('');
  const summary = kind === 'gmb' ? '' : `<div class="summary-grid"><div><span>Localité</span><strong>${escapeHtml(result.input.city.label)}</strong></div><div><span>Mots-clés retenus</span><strong>${keywords.length}</strong></div><div><span>Pistes concurrentielles</span><strong>${competitors.length}</strong></div></div>`;
  const body = kind === 'gmb'
    ? `<section><h2>Périmètre</h2>${selectedIdentity}<p>${gmbCandidates.length} établissement(s) correspondant(s) au nom recherché dans le périmètre observé.</p>${gmbCandidates.length ? `<ul>${gmbCandidates.map(item => `<li>${escapeHtml(item.title ?? 'Établissement sans nom')}</li>`).join('')}</ul>` : '<div class="empty-state">Aucun établissement n’a été suffisamment corroboré par la source GMB.</div>'}</section>`
    : `<section><h2>GMB</h2>${selectedIdentity}<p>${gmbCandidates.length} établissement(s) correspondant(s) au nom recherché.</p>${gmbCandidates.length ? `<ul>${gmbCandidates.map(item => `<li>${escapeHtml(item.title ?? 'Établissement sans nom')}</li>`).join('')}</ul>` : result.input.mode === 'LOCAL_PREVIEW_WITHOUT_GMB' ? '<div class="empty-state">Audit GMB non exécuté dans cet aperçu local.</div>' : '<div class="empty-state">Aucune correspondance GMB suffisamment corroborée.</div>'}</section><section><h2>Site et SEO</h2><p>Site : ${escapeHtml(result.input.domain ?? 'non confirmé')}.</p><p>${result.modules.seo?.summary ? `${escapeHtml(result.modules.seo.summary.pagesAnalyzed)} page(s) analysée(s).` : 'Audit SEO de base non exécuté.'}</p></section><section><h2>Recherche</h2>${researchPlan ? `<p class="section-intro">Catégorie observée : ${escapeHtml(researchPlan.category ?? 'non disponible')}. Les métriques de mots-clés sont à l’échelle ${escapeHtml(researchPlan.country ?? 'non disponible')} ; la visibilité locale provient des résultats géolocalisés.</p>` : ''}${renderKeywordTable(keywords)}</section><section><h2>Concurrence observée</h2>${renderCompetitorTable(competitors)}</section><section><h2>Recommandations</h2>${(result.modules.strategy?.recommendations ?? []).length ? `<ul>${result.modules.strategy.recommendations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<div class="empty-state">Aucune recommandation fondée sur les données observées.</div>'}</section><section><h2>Limites</h2><p>Une métrique de mot-clé ne prouve pas une demande communale. Les résultats locaux sont explicitement séparés des opportunités de marché. ${rejectedKeywords.length ? 'Les résultats hors activité ou dupliqués ne sont pas affichés.' : ''}</p></section>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>${reportStyles()}</style></head><body><main><header class="report-header"><div class="report-kicker">${statusDot(displayStatus)}<span>${escapeHtml(title.toUpperCase())}</span></div><h1>${escapeHtml(result.input.name)}</h1><p>${escapeHtml(result.input.city.label)} · Observation : ${escapeHtml(result.startedAt)}</p></header>${summary}<div class="report-content">${body}<section><h2>Étapes</h2><ul>${stages}</ul></section><section><h2>Preuves</h2>${evidence ? `<ul>${evidence}</ul>` : '<div class="empty-state">Aucune preuve provider livrée.</div>'}</section></div></main></body></html>`;
}
