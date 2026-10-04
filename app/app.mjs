import { api } from './api.mjs';
import { icon } from './icons.mjs';

const views = [
  { id: 'inbox', label: 'À traiter', icon: 'inbox', group: 'ops' },
  { id: 'runs', label: 'Runs', icon: 'runs', group: 'ops' },
  { id: 'dossiers', label: 'Dossiers', icon: 'dossiers', group: 'ops' },
  { id: 'configuration', label: 'Configuration', icon: 'config', group: 'control' },
  { id: 'providers', label: 'Providers', icon: 'providers', group: 'control' },
  { id: 'internet', label: 'Internet', icon: 'internet', group: 'control' },
];

const state = {
  view: 'inbox',
  selected: {},
  runTab: 'overview',
  dossierTab: 'identity',
  configurationTab: 'workflows',
  configurationCreating: null,
  configurationDraft: null,
  configurationOpenSteps: new Set(),
  configurationModels: {},
  internetQuery: '',
  internetResult: null,
  internetConfigOpen: false,
};

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const list = $('#list');
const detail = $('#detail');
let toastTimer;
let renderQueue = Promise.resolve();
let pointerScroll = null;

function capturePointerScroll(event) {
  if (!event.target.closest('button, input, select, textarea, a')) return;
  if (event.target.closest('.step-main')) event.preventDefault();
  const saved = { top: detail.scrollTop, left: detail.scrollLeft, pageTop: document.scrollingElement?.scrollTop ?? 0, pageLeft: document.scrollingElement?.scrollLeft ?? 0 };
  pointerScroll = saved;
}

function restorePointerScroll() {
  if (!pointerScroll) return;
  const saved = pointerScroll;
  setTimeout(() => {
    detail.scrollTop = saved.top;
    detail.scrollLeft = saved.left;
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = saved.pageTop;
      document.scrollingElement.scrollLeft = saved.pageLeft;
    }
    if (pointerScroll === saved) pointerScroll = null;
  }, 0);
}

detail.addEventListener('pointerdown', capturePointerScroll, true);
detail.addEventListener('mousedown', capturePointerScroll, true);
detail.addEventListener('pointerup', restorePointerScroll, true);
detail.addEventListener('mouseup', restorePointerScroll, true);
detail.addEventListener('click', restorePointerScroll, true);

function notify(message) {
  clearTimeout(toastTimer);
  $('#status').textContent = message;
  $('#status').classList.toggle('visible', Boolean(message));
  if (message) toastTimer = setTimeout(() => $('#status').classList.remove('visible'), 4200);
}

function renderNav() {
  for (const group of ['ops', 'control']) {
    const root = $(`#${group}-nav`);
    root.innerHTML = views.filter(view => view.group === group).map(view => `
      <button class="nav-item ${state.view === view.id ? 'active' : ''}" type="button" aria-label="${esc(view.label)}" data-view="${view.id}" ${state.view === view.id ? 'aria-current="page"' : ''}>
        <span class="nav-icon">${icon(view.icon)}</span><span class="nav-label">${view.label}</span>
      </button>`).join('');
  }
}

function badge(value) {
  const label = statusLabel(value);
  return `<span class="badge ${statusTone(value)}"><span class="state-dot" aria-hidden="true"></span>${esc(label)}</span>`;
}

function stateIndicator(value) {
  const label = statusLabel(value);
  return `<span class="badge ${statusTone(value)}" aria-label="${esc(label)}" title="${esc(label)}"><span class="state-dot" aria-hidden="true"></span></span>`;
}

function statusTone(value) {
  if (['SUCCEEDED', 'PASS', 'APPROVED', 'healthy', 'INTAKE_COMPLETE'].includes(value)) return 'pass';
  if (['FAILED', 'BLOCKED', 'CHANGES_REQUESTED', 'unhealthy'].includes(value)) return 'block';
  if (['RUNNING', 'WAITING_FOR_APPROVAL'].includes(value)) return 'active';
  return 'warn';
}

function statusLabel(value) {
  return ({
    SUCCEEDED: 'Terminé', FAILED: 'Échec', BLOCKED: 'Bloqué', RUNNING: 'En cours',
    APPROVED: 'Validé', CHANGES_REQUESTED: 'Corrections', INTAKE_COMPLETE: 'Complet',
    healthy: 'Testé', unhealthy: 'Erreur', unknown: 'Non testé', PASS: 'PASS', WARN: 'WARN',
  })[value] ?? value ?? 'Inconnu';
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function listHeader(title, action = '') {
  return `<header class="list-header"><h1>${esc(title)}</h1>${action}</header>`;
}

function emptyState(title, text, action = '') {
  return `<section class="empty-state"><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</section>`;
}

function iconControl(label, name, attributes = '') {
  return `<button class="icon-control" type="button" aria-label="${esc(label)}" title="${esc(label)}" ${attributes}>${icon(name)}</button>`;
}

function bindAll(selector, handler) {
  document.querySelectorAll(selector).forEach(element => element.addEventListener('click', event => handler(event.currentTarget, event)));
}

async function perform(button, operation, successMessage = '') {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const value = await operation();
    if (successMessage) notify(successMessage);
    return { ok: true, value };
  } catch (error) {
    notify(error.message);
    return { ok: false, value: null };
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function loading() {
  list.innerHTML = '<div class="loading-line"></div><div class="loading-line short"></div>';
  detail.innerHTML = '<div class="detail-inner"><div class="loading-line"></div><div class="loading-panel"></div></div>';
}

function showError(error) {
  list.innerHTML = listHeader(views.find(view => view.id === state.view)?.label ?? 'Ancrage');
  detail.innerHTML = emptyState('Impossible de charger cette vue', error.message, '<button class="btn primary" type="button" data-retry>Réessayer</button>');
  $('[data-retry]')?.addEventListener('click', render);
}

async function go(view, selectedId = null) {
  state.view = view;
  if (selectedId) state.selected[view] = selectedId;
  await render({ preserveScroll: false });
  detail.focus({ preventScroll: true });
}

function latestRunsByDossier(runs) {
  const result = new Map();
  [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).forEach(run => {
    if (run.input?.dossierId && !result.has(run.input.dossierId)) result.set(run.input.dossierId, run);
  });
  return result;
}

function dossierName(run, dossiers) {
  return dossiers.find(item => item.id === run.input?.dossierId)?.name ?? run.workflowId;
}

function inboxDescriptor(dossier, run) {
  if (!run) return { action: 'Préparer le site', phase: 'Dossier reçu', status: 'WARN', kind: 'start' };
  if (run.status === 'FAILED' || run.status === 'BLOCKED') return { action: 'Voir les corrections', phase: 'Run interrompu', status: run.status, kind: 'run' };
  if (run.operatorDecision?.decision === 'CHANGES_REQUESTED') return { action: 'Voir les corrections', phase: 'Corrections demandées', status: 'CHANGES_REQUESTED', kind: 'run' };
  if (run.status === 'SUCCEEDED' && !run.operatorDecision) return { action: 'Vérifier les artefacts', phase: 'Validation finale', status: 'WARN', kind: 'run' };
  if (run.status === 'RUNNING') return { action: 'Suivre le run', phase: 'Création en cours', status: 'RUNNING', kind: 'run' };
  return null;
}

function publicInboxDescriptor(item) {
  const status = item.preparation?.status;
  if (status === 'READY_FOR_OWNER_REVIEW') return { action: 'Valider la démo', phase: 'Validation opérateur', status: 'WARN' };
  if (status === 'READY_FOR_PROSPECT') return { action: 'Ouvrir la démo', phase: 'Démo validée', status: 'APPROVED' };
  if (status === 'NEEDS_CORRECTION') return { action: 'Voir les corrections', phase: 'Corrections demandées', status: 'CHANGES_REQUESTED' };
  return { action: 'Vérifier la préparation', phase: 'Préparation reçue', status: 'WARN' };
}

async function renderInbox() {
  const [dossiers, runs, publicDemoRequests] = await Promise.all([api.dossiers(), api.runs(), api.publicDemoRequests()]);
  const latest = latestRunsByDossier(runs);
  const items = [
    ...dossiers.map(dossier => ({ kind: 'local', dossier, run: latest.get(dossier.id) ?? null })).map(item => ({ ...item, descriptor: inboxDescriptor(item.dossier, item.run) })).filter(item => item.descriptor),
    ...publicDemoRequests.map(publicItem => ({ kind: 'public', publicItem, descriptor: publicInboxDescriptor(publicItem) })),
  ];
  list.innerHTML = listHeader('À traiter') + (items.length ? items.map(item => `
    <button class="list-row ${state.selected.inbox === (item.kind === 'public' ? `public:${item.publicItem.preparation.id}` : item.dossier.id) ? 'active' : ''}" type="button" data-inbox-select="${item.kind === 'public' ? `public:${item.publicItem.preparation.id}` : item.dossier.id}">
      <span class="row-top"><strong>${esc(item.kind === 'public' ? item.publicItem.request.input.name : item.dossier.name)}</strong>${item.kind === 'public' ? stateIndicator(item.descriptor.status) : badge(item.descriptor.status)}</span>
      <span class="row-meta">${esc(item.descriptor.action)}</span>
    </button>`).join('') : '<p class="list-empty">Aucune décision en attente.</p>');
  if (!items.length) {
    detail.innerHTML = emptyState('Tout est à jour', 'Un nouveau dossier apparaîtra ici dès que l’intake aura été validé.', '<a class="btn primary" href="/intake.html" target="_blank" rel="noopener">Ouvrir l’intake</a>');
    return;
  }
  const selected = items.find(item => (item.kind === 'public' ? `public:${item.publicItem.preparation.id}` : item.dossier.id) === state.selected.inbox) ?? items[0];
  const selectedKey = selected.kind === 'public' ? `public:${selected.publicItem.preparation.id}` : selected.dossier.id;
  state.selected.inbox = selectedKey;
  document.querySelector(`[data-inbox-select="${selectedKey}"]`)?.classList.add('active');
  if (selected.kind === 'public') {
    const { request, preparation } = selected.publicItem;
    const checks = Object.entries(preparation.checklist ?? {}).map(([label, value]) => ({ label, status: value ? 'PASS' : 'WARN' }));
    const actions = preparation.status === 'READY_FOR_OWNER_REVIEW'
      ? '<button class="btn primary" type="button" data-public-decision="APPROVED">Valider</button><button class="btn" type="button" data-public-decision="CHANGES_REQUESTED">Renvoyer en correction</button>'
      : preparation.presentation?.href ? `<a class="btn primary" href="${esc(preparation.presentation.href)}" target="_blank" rel="noopener">Ouvrir la démo</a>` : '';
    detail.innerHTML = `<div class="detail-inner"><header class="inspect-head"><div><h2>${esc(request.input.name)}</h2><p>${esc(selected.descriptor.phase)}</p></div><div class="detail-actions inbox-actions">${actions}</div></header><section class="panel"><div class="section-label">À faire</div><strong>${esc(selected.descriptor.action)}</strong></section><section class="panel"><div class="section-label">État vérifié</div>${checks.map(check => `<div class="step-row"><span>${esc(check.label)}</span>${stateIndicator(check.status)}</div>`).join('')}</section></div>`;
    bindAll('[data-inbox-select]', button => { state.selected.inbox = button.dataset.inboxSelect; render(); });
    bindAll('[data-public-decision]', async button => { const result = await perform(button, () => api.publicDecision(preparation.id, button.dataset.publicDecision), button.dataset.publicDecision === 'APPROVED' ? 'Démo validée.' : 'Correction demandée.'); if (result.ok) await render(); });
    return;
  }
  const checks = selected.run ? selected.run.steps.map(step => ({ label: step.id, status: step.status })) : [
    { label: 'Histoire', status: selected.dossier.hasStory ? 'PASS' : 'WARN' },
    { label: 'Menu', status: selected.dossier.menuItemCount ? 'PASS' : 'WARN' },
    { label: 'Image', status: selected.dossier.assetCount ? 'PASS' : 'WARN' },
  ];
  detail.innerHTML = `<div class="detail-inner">
    <header class="inspect-head">
      <div><h2>${esc(selected.dossier.name)}</h2><p>${esc(selected.descriptor.phase)}</p></div>
      <div class="detail-actions inbox-actions">
        <button class="btn primary ${selected.descriptor.action === 'Voir les corrections' ? 'corrections' : ''}" type="button" data-inbox-action="${selected.descriptor.kind}">${esc(selected.descriptor.action)}</button>
        ${iconControl('Ouvrir le dossier', 'folder', `data-open-dossier="${selected.dossier.id}"`)}
      </div>
    </header>
    <section class="panel"><div class="section-label">À faire</div><strong>${esc(selected.descriptor.action)}</strong></section>
    <section class="panel"><div class="section-label">État vérifié</div>${checks.map(check => `<div class="step-row"><span>${esc(check.label)}</span>${badge(check.status)}</div>`).join('')}</section>
  </div>`;
  bindAll('[data-inbox-select]', button => { state.selected.inbox = button.dataset.inboxSelect; render(); });
  $('[data-inbox-action]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.dataset.inboxAction === 'start') {
      const result = await perform(button, () => api.startDossierRun(selected.dossier.id), 'Création lancée.');
      if (result.ok) await go('runs', result.value.id);
    } else await go('runs', selected.run.id);
  });
  bindOpenDossier();
}

function bindOpenDossier() {
  bindAll('[data-open-dossier]', button => perform(button, () => api.openDossier(button.dataset.openDossier), 'Dossier ouvert dans Finder.'));
}

async function renderRuns() {
  const [rawRuns, dossiers] = await Promise.all([api.runs(), api.dossiers()]);
  const runs = [...rawRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  list.innerHTML = listHeader('Runs') + (runs.length ? `<label class="search-field"><span class="sr-only">Rechercher un run</span>${icon('search')}<input type="search" placeholder="Rechercher" data-run-search></label><div class="section-label">Exécutions</div>${runs.map(run => `
    <button class="list-row ${state.selected.runs === run.id ? 'active' : ''}" type="button" data-run-select="${run.id}" data-search-value="${esc(`${run.id} ${dossierName(run, dossiers)} ${run.workflowId}`.toLowerCase())}">
      <span class="row-top"><strong>${esc(dossierName(run, dossiers))}</strong>${badge(run.status)}</span>
      <span class="row-meta">${esc(run.workflowId)} · ${formatDate(run.updatedAt)}</span>
    </button>`).join('')}` : '<p class="list-empty">Aucun run enregistré.</p>');
  if (!runs.length) {
    detail.innerHTML = emptyState('Aucune exécution', 'Lancez la création depuis un dossier prêt.');
    return;
  }
  const run = runs.find(item => item.id === state.selected.runs) ?? runs[0];
  state.selected.runs = run.id;
  document.querySelector(`[data-run-select="${run.id}"]`)?.classList.add('active');
  const dossier = dossiers.find(item => item.id === run.input?.dossierId) ?? null;
  const artifacts = await api.artifacts(run.id).catch(() => []);
  const site = artifacts.find(item => item.kind === 'site');
  const gmbReport = artifacts.find(item => item.kind === 'gmb-report');
  const seoReport = artifacts.find(item => item.kind === 'seo-report');
  const events = state.runTab === 'journal' ? await api.events(run.id).catch(() => []) : [];
  const checkpoint = [...run.steps].reverse().find(step => step.status === 'SUCCEEDED');
  const failedAttempt = [...run.attempts].reverse().find(attempt => attempt.status === 'FAILED');
  const runActions = [];
  if (['FAILED', 'BLOCKED'].includes(run.status)) runActions.push('<button class="btn primary" type="button" data-resume-run>Reprendre</button>');
  if (run.workflowId === 'client-site-simulation' && run.status === 'SUCCEEDED' && !run.operatorDecision) {
    runActions.push('<button class="btn primary" type="button" data-run-decision="APPROVED">Valider</button>');
    runActions.push('<button class="btn" type="button" data-run-decision="CHANGES_REQUESTED">Renvoyer en correction</button>');
  }
  if (run.operatorDecision?.decision === 'CHANGES_REQUESTED' && dossier) runActions.push('<button class="btn primary" type="button" data-rerun-dossier>Relancer après correction</button>');
  if (run.operatorDecision?.decision === 'APPROVED' && site) runActions.push(`<a class="btn primary" href="${esc(site.href)}" target="_blank" rel="noopener">Voir le site</a>`);
  if (dossier) runActions.push(iconControl('Ouvrir le dossier', 'folder', `data-open-dossier="${dossier.id}"`));
  const runTabs = [['overview', 'Vue'], ['steps', 'Étapes'], ['proofs', 'Preuves'], ['versions', 'Versions'], ['journal', 'Journal']];
  const snapshotRows = run.snapshot.steps.map(step => `<div class="snapshot-step"><strong>${esc(step.id)}</strong>${step.promptRef ? `<small>Prompt : ${esc(step.promptRef)} · ${esc(step.promptVersionId)}</small><small>Modèle : ${esc(step.model)}</small>` : '<small>Étape déterministe</small>'}${step.contractRef ? `<small>Contrat : ${esc(step.contractRef)}${step.contractVersionId ? ` · ${esc(step.contractVersionId)}` : ''}</small>` : ''}${step.profile ? `<small>Profil CLI : ${esc(step.profile)}${step.profileVersionId ? ` · ${esc(step.profileVersionId)}` : ''}</small>` : ''}</div>`).join('');
  const progress = `<section class="panel"><div class="section-label">Progression</div>${run.snapshot.steps.map(snapshot => {
    const step = run.steps.find(item => item.id === snapshot.id);
    return `<div class="step-row"><span><strong>${esc(snapshot.id)}</strong>${failedAttempt?.stepId === snapshot.id ? `<small>Échec précédent · ${esc(failedAttempt.errorCode)}</small>` : ''}</span>${badge(step?.status ?? 'EN ATTENTE')}</div>`;
  }).join('')}</section>`;
  const runBody = state.runTab === 'steps' ? progress : state.runTab === 'proofs' ? `<section class="panel"><div class="section-label">Artefacts</div>${artifacts.length ? `<div class="artifact-links">${site ? `<a href="${esc(site.href)}" target="_blank" rel="noopener">Voir le site ${icon('external')}</a>` : ''}${gmbReport ? `<a href="${esc(gmbReport.href)}" target="_blank" rel="noopener">Voir le rapport GMB ${icon('external')}</a>` : ''}${seoReport ? `<a href="${esc(seoReport.href)}" target="_blank" rel="noopener">Voir le rapport SEO ${icon('external')}</a>` : ''}</div>` : '<p class="muted">Aucun artefact disponible pour ce run.</p>'}</section><section class="panel"><div class="section-label">Dossier source</div><p>${dossier ? `${esc(dossier.name)} · ${esc(dossier.city)} · ${dossier.assetCount} média` : 'Dossier introuvable.'}</p></section>` : state.runTab === 'versions' ? `<section class="panel"><div class="section-label">Configuration figée pour ce run</div><div class="snapshot-head"><span><small>Workflow</small><strong>${esc(run.workflowId)}</strong></span><span><small>Version active</small><strong>${esc(run.snapshot.workflowVersionId ?? run.snapshot.workflowVersion)}</strong></span><span><small>Hash</small><strong>${esc(run.snapshot.workflowHash ?? 'Ancien run sans hash')}</strong></span></div>${snapshotRows}</section>` : state.runTab === 'journal' ? `<section class="panel"><div class="section-label">Journal</div>${events.length ? events.map(event => `<div class="event-row"><span>${formatDate(event.at)}</span><strong>${esc(event.type)}</strong><small>${esc(event.stepId ?? event.decision ?? '')}</small></div>`).join('') : '<p class="muted">Aucun événement enregistré.</p>'}</section>` : `<section class="preview-card"><div class="preview-matter" aria-hidden="true"></div><div class="preview-copy"><span>Site démo</span><strong>${esc(dossier?.name ?? run.workflowId)}</strong><small>${esc(run.workflowId)} · ${run.status === 'SUCCEEDED' ? 'Aperçu prêt' : 'Aperçu en préparation'}</small></div></section><section class="facts">
      <div class="fact"><small>État</small><strong>${badge(run.status)}</strong></div>
      <div class="fact"><small>Checkpoint fiable</small><strong>${esc(checkpoint?.id ?? 'Aucun')}</strong></div>
      <div class="fact"><small>Tentatives</small><strong>${run.attempts.length}</strong></div>
      <div class="fact"><small>Décision</small><strong>${run.operatorDecision ? badge(run.operatorDecision.decision) : 'À prendre'}</strong></div>
    </section>${progress}`;
  detail.innerHTML = `<div class="detail-inner">
    <header class="inspect-head"><div><div class="eyebrow">Run · ${esc(run.id)}</div><h2>${esc(dossier?.name ?? run.workflowId)}</h2><p>${esc(run.workflowId)}</p></div><div class="detail-actions">${runActions.join('')}</div></header>
    <nav class="tabs" aria-label="Sections du run">${runTabs.map(([id, label]) => `<button class="${state.runTab === id ? 'active' : ''}" type="button" data-run-tab="${id}">${label}</button>`).join('')}</nav>
    ${runBody}
  </div>`;
  bindAll('[data-run-tab]', button => { state.runTab = button.dataset.runTab; render(); });
  bindAll('[data-run-select]', button => { state.selected.runs = button.dataset.runSelect; state.runTab = 'overview'; render(); });
  $('[data-run-search]')?.addEventListener('input', event => {
    const query = event.currentTarget.value.trim().toLowerCase();
    document.querySelectorAll('[data-search-value]').forEach(row => { row.hidden = !row.dataset.searchValue.includes(query); });
  });
  $('[data-resume-run]')?.addEventListener('click', async event => {
    const result = await perform(event.currentTarget, () => api.resumeRun(run.id), 'Run repris depuis le dernier checkpoint.');
    if (result.ok) await render();
  });
  bindAll('[data-run-decision]', async button => {
    const decision = button.dataset.runDecision;
    if (decision === 'APPROVED' && !window.confirm('Valider ces artefacts pour la suite du parcours ?')) return;
    const result = await perform(button, () => api.decideRun(run.id, decision), decision === 'APPROVED' ? 'Run validé.' : 'Corrections demandées.');
    if (result.ok) await render();
  });
  $('[data-rerun-dossier]')?.addEventListener('click', async event => {
    const result = await perform(event.currentTarget, () => api.startDossierRun(dossier.id), 'Nouveau run lancé.');
    if (result.ok) { state.selected.runs = result.value.id; await render(); }
  });
  bindOpenDossier();
}

async function renderDossiers() {
  const [dossiers, runs] = await Promise.all([api.dossiers(), api.runs()]);
  const intakeAction = `<a class="icon-control" href="/intake.html" target="_blank" rel="noopener" aria-label="Ouvrir l’intake" title="Ouvrir l’intake">${icon('plus')}</a>`;
  list.innerHTML = listHeader('Dossiers', intakeAction) + (dossiers.length ? `<label class="search-field"><span class="sr-only">Rechercher un dossier</span>${icon('search')}<input type="search" placeholder="Rechercher" data-dossier-search></label><div class="section-label">Dossiers suivis</div>${dossiers.map(dossier => `
    <button class="list-row ${state.selected.dossiers === dossier.id ? 'active' : ''}" type="button" data-dossier-select="${dossier.id}" data-search-value="${esc(`${dossier.name} ${dossier.city}`.toLowerCase())}">
      <span class="row-top"><strong>${esc(dossier.name)}</strong>${badge(dossier.status)}</span>
      <span class="row-meta">${esc(dossier.city)} · ${dossier.assetCount} média</span>
    </button>`).join('')}` : '<p class="list-empty">Aucun dossier reçu.</p>');
  if (!dossiers.length) {
    detail.innerHTML = emptyState('Aucun dossier', 'Validez un intake pour créer le premier dossier local.', '<a class="btn primary" href="/intake.html" target="_blank" rel="noopener">Ouvrir l’intake</a>');
    return;
  }
  const summary = dossiers.find(item => item.id === state.selected.dossiers) ?? dossiers[0];
  state.selected.dossiers = summary.id;
  document.querySelector(`[data-dossier-select="${summary.id}"]`)?.classList.add('active');
  const dossier = await api.dossier(summary.id);
  const latest = [...runs].filter(run => run.input?.dossierId === dossier.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  const primary = latest ? `<button class="btn primary" type="button" data-open-run="${latest.id}">Voir le run</button>` : '<button class="btn primary" type="button" data-start-dossier>Lancer la création</button>';
  const tabs = [['identity', 'Identité'], ['story', 'Histoire'], ['menu', 'Menu'], ['media', 'Médias']];
  let body;
  if (state.dossierTab === 'story') body = `<section class="panel"><div class="section-label">Texte fourni</div><p class="preserve">${esc(dossier.story || 'Aucune histoire fournie.')}</p></section>`;
  else if (state.dossierTab === 'menu') body = `<section class="panel"><div class="section-label">Menu fourni</div>${dossier.menu.length ? dossier.menu.map(item => `<div class="menu-row"><span><strong>${esc(item.name)}</strong>${item.description ? `<small>${esc(item.description)}</small>` : ''}</span><span>${item.price === null ? '—' : esc(item.price)}</span></div>`).join('') : '<p class="muted">Aucun plat fourni.</p>'}</section>`;
  else if (state.dossierTab === 'media') body = `<section class="panel"><div class="section-label">Médias reçus</div>${dossier.assets.length ? `<div class="media-grid">${dossier.assets.map(asset => `<figure><img src="/api/dossiers/${dossier.id}/assets/${encodeURIComponent(asset.name)}" alt="${esc(asset.alt || dossier.name)}"><figcaption>${esc(asset.name)} · ${Math.ceil(asset.size / 1024)} Ko</figcaption></figure>`).join('')}</div>` : '<p class="muted">Aucun média fourni.</p>'}</section>`;
  else body = `<section class="facts"><div class="fact"><small>Ville</small><strong>${esc(dossier.city)}</strong></div><div class="fact"><small>Pays</small><strong>${esc(dossier.country || '—')}</strong></div><div class="fact"><small>Source</small><strong>${esc(dossier.source)}</strong></div><div class="fact"><small>Dernier run</small><strong>${latest ? badge(latest.status) : 'Non lancé'}</strong></div></section><section class="panel"><div class="section-label">Adresse</div><p>${esc(dossier.address || 'Non fournie')}</p></section>`;
  detail.innerHTML = `<div class="detail-inner">
    <header class="inspect-head"><div><div class="eyebrow">Dossier · identité et contenu</div><h2>${esc(dossier.name)}</h2><p>${esc(dossier.city)}</p></div><div class="detail-actions">${primary}${iconControl('Ouvrir le dossier', 'folder', `data-open-dossier="${dossier.id}"`)}</div></header>
    <nav class="tabs" aria-label="Sections du dossier">${tabs.map(([id, label]) => `<button class="${state.dossierTab === id ? 'active' : ''}" type="button" data-dossier-tab="${id}">${label}</button>`).join('')}</nav>
    ${body}
  </div>`;
  bindAll('[data-dossier-select]', button => { state.selected.dossiers = button.dataset.dossierSelect; state.dossierTab = 'identity'; render(); });
  bindAll('[data-dossier-tab]', button => { state.dossierTab = button.dataset.dossierTab; render(); });
  $('[data-dossier-search]')?.addEventListener('input', event => {
    const query = event.currentTarget.value.trim().toLowerCase();
    document.querySelectorAll('[data-search-value]').forEach(row => { row.hidden = !row.dataset.searchValue.includes(query); });
  });
  $('[data-open-run]')?.addEventListener('click', event => go('runs', event.currentTarget.dataset.openRun));
  $('[data-start-dossier]')?.addEventListener('click', async event => {
    const result = await perform(event.currentTarget, () => api.startDossierRun(dossier.id), 'Création lancée.');
    if (result.ok) await go('runs', result.value.id);
  });
  bindOpenDossier();
}

const csv = value => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
const contractId = value => String(value ?? '').replace(/^contracts\//, '').replace(/\.schema\.json$/, '');
const jsonText = value => JSON.stringify(value ?? {}, null, 2);

function promptBody(markdown) {
  const closing = markdown.indexOf('\n---\n', 4);
  return closing < 0 ? markdown : markdown.slice(closing + 5).trim();
}

function promptMarkdown({ id, name, ownerStep, outputContract, body }) {
  return `---\nid: ${id}\nname: ${name}\nownerStep: ${ownerStep}\noutputContract: ${outputContract}\n---\n${body.trim()}\n`;
}

function numberField(value, attributes = '') {
  return `<input type="text" inputmode="decimal" value="${esc(value)}" ${attributes}>`;
}

function rememberConfigurationDraft(source, read) {
  const sync = () => {
    try { state.configurationDraft = { ...source, ...read() }; } catch {}
  };
  detail.querySelectorAll('input, textarea, select').forEach(input => {
    input.addEventListener('pointerdown', event => event.stopPropagation());
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
  });
}

function workflowStepEditor(step, index, prompts, contracts, cliProfiles, providers, models, templates, workflowId) {
  const option = (value, label) => `<option value="${value}" ${step.kind === value ? 'selected' : ''}>${label}</option>`;
  const contractOptions = contracts.map(contract => `<option value="${esc(contract.id)}" ${contractId(step.contractRef) === contract.id ? 'selected' : ''}>${esc(contract.name ?? contract.id)}</option>`).join('');
  const profileOptions = cliProfiles.map(profile => `<option value="${esc(profile.id)}" ${step.profile === profile.id ? 'selected' : ''}>${esc(profile.name ?? profile.id)}</option>`).join('');
  const providerOptions = [...providers, ...(step.provider && !providers.some(provider => provider.id === step.provider) ? [{ id: step.provider, name: step.provider }] : [])].map(provider => `<option value="${esc(provider.id)}" ${step.provider === provider.id ? 'selected' : ''}>${esc(provider.name ?? provider.id)}</option>`).join('');
  const modelOptions = [...models, ...(step.model && !models.some(model => model.id === step.model) ? [{ id: step.model, name: step.model }] : [])].map(model => `<option value="${esc(model.id)}" ${step.model === model.id ? 'selected' : ''}>${esc(model.name ?? model.id)}</option>`).join('');
  const refs = (items, label, field) => `<div class="step-resource"><small>${label}</small><span>${items.length ? items.map(item => `<button type="button" class="resource-link" data-open-workflow-resource data-workflow-id="${esc(workflowId)}" data-step-id="${esc(step.id)}" data-resource-field="${field}" data-resource-reference="${esc(item)}" aria-label="Afficher ${esc(item)} dans Finder" title="Afficher ${esc(item)} dans Finder">${icon('folder')}${esc(item)}</button>`).join('') : 'Aucune'}</span></div>`;
  const hasAiFields = step.kind === 'ai';
  return `<section class="workflow-editor-step ${step.open ? 'is-open' : ''}" data-workflow-step data-step-trigger="${esc(step.trigger ?? '')}" data-step-approval="${esc(step.approval ?? 'none')}">
    <div class="workflow-editor-toggle"><button class="step-main" type="button" aria-expanded="${step.open ? 'true' : 'false'}"><span class="step-order">${index + 1}</span><span class="step-summary"><strong>${esc(step.id || `Étape ${index + 1}`)}</strong><small>${step.kind === 'ai' ? 'IA' : 'Déterministe'}</small></span><span class="step-toggle" aria-hidden="true"></span></button><span class="step-summary-resources">${refs(step.inputRefs ?? [], 'Entrées', 'inputRefs')}${refs(step.outputRefs ?? [], 'Sorties', 'outputRefs')}</span></div>
    <div class="workflow-editor-body">
      <div class="workflow-editor-actions">${iconControl(`Supprimer l’étape ${index + 1}`, 'trash', 'data-remove-workflow-step')}</div>
      <div class="form-grid">
        <label class="field"><span>Identifiant</span><input value="${esc(step.id ?? '')}" data-step-field="id" placeholder="analyse"></label>
        <label class="field"><span>Type</span><select data-step-field="kind">${option('deterministic', 'Déterministe')}${option('ai', 'IA')}</select></label>
        <label class="field span-2"><span>Implémentation</span><input value="${esc(step.implementation ?? '')}" data-step-field="implementation" placeholder="nom-de-l-implementation"></label>
        <label class="field ${step.dependsOn?.length ? '' : 'is-empty'}"><span>Dépend de</span><input value="${esc((step.dependsOn ?? []).join(', '))}" data-step-field="dependsOn" placeholder="étape-précédente"></label>
        <label class="field"><span>Entrées reçues</span><input value="${esc((step.inputRefs ?? []).join(', '))}" data-step-field="inputRefs" placeholder="étape-précédente"></label>
        <label class="field span-2"><span>Sorties produites</span><input value="${esc((step.outputRefs ?? []).join(', '))}" data-step-field="outputRefs" placeholder="rapport, preuves"></label>
        <label class="field ${hasAiFields ? '' : 'is-conditional'}"><span>Prompt</span><select data-step-field="promptRef"><option value="">Aucun</option>${prompts.map(prompt => `<option value="${esc(prompt.id)}" ${step.promptRef === prompt.id ? 'selected' : ''}>${esc(prompt.name)}</option>`).join('')}</select></label>
        <label class="field ${hasAiFields ? '' : 'is-conditional'}"><span>Acteur</span><input value="${esc(step.actor ?? '')}" data-step-field="actor" placeholder="rôle"></label>
        <label class="field ${hasAiFields ? '' : 'is-conditional'}"><span>Provider</span><select data-step-field="provider" data-step-provider><option value="">Aucun</option>${providerOptions}</select></label>
        <label class="field ${hasAiFields ? '' : 'is-conditional'}"><span>Modèle</span><select data-step-field="model" data-step-model><option value="">Choisir un modèle</option>${modelOptions}</select></label>
        <label class="field ${step.profile ? '' : 'is-empty'}"><span>Profil CLI</span><select data-step-field="profile"><option value="">Aucun</option>${profileOptions}</select></label>
        <label class="field ${step.outputTemplateId ? '' : 'is-empty'}"><span>Template de sortie</span><select data-step-field="outputTemplateId"><option value="">Aucun</option>${templates.map(template => `<option value="${esc(template.id)}" ${step.outputTemplateId === template.id ? 'selected' : ''}>${esc(template.name ?? template.id)}</option>`).join('')}</select></label>
        <label class="field ${step.contractRef ? '' : 'is-empty'}"><span>Contrat de sortie</span><select data-step-field="contractRef"><option value="">Aucun</option>${contractOptions}</select></label>
        <label class="field"><span>Timeout en ms</span>${numberField(step.timeoutMs ?? 1000, 'data-step-field="timeoutMs"')}</label>
        <label class="field"><span>Budget maximum</span>${numberField(step.budget ?? 0, 'data-step-field="budget"')}</label>
      </div>
    </div>
  </section>`;
}

function readWorkflowForm() {
  const steps = [...document.querySelectorAll('[data-workflow-step]')].map((row, index) => {
    const value = name => row.querySelector(`[data-step-field="${name}"]`).value.trim();
    const step = {
      id: value('id'), kind: value('kind'), trigger: row.dataset.stepTrigger || (index === 0 ? 'start' : 'ready'),
      dependsOn: csv(value('dependsOn')), inputRefs: csv(value('inputRefs')), outputRefs: csv(value('outputRefs')),
      implementation: value('implementation'), timeoutMs: Number(value('timeoutMs')), budget: Number(value('budget')), approval: row.dataset.stepApproval || 'none', profile: value('profile'), outputTemplateId: value('outputTemplateId'),
    };
    if (step.kind === 'ai') {
      step.actor = value('actor');
      step.provider = value('provider');
      if (value('promptRef')) step.promptRef = value('promptRef');
      if (value('model')) step.model = value('model');
    }
    if (value('contractRef')) step.contractRef = value('contractRef');
    return step;
  });
  return { id: $('[data-workflow-id]').value.trim(), name: $('[data-workflow-name]').value.trim(), version: Number($('[data-workflow-version]').value), outputTemplateId: $('[data-workflow-template]').value, limits: Object.fromEntries([...document.querySelectorAll('[data-limit]')].map(input => [input.dataset.limit, Number(input.value)])), steps };
}

function readPromptForm() {
  const id = $('[data-prompt-id]').value.trim();
  const name = $('[data-prompt-name]').value.trim();
  const ownerStep = $('[data-prompt-owner]').value.trim();
  const outputContract = $('[data-prompt-contract]').value.trim();
  const markdown = promptMarkdown({ id, name, ownerStep, outputContract, body: $('[data-prompt-body]').value });
  return { id, name, ownerStep, outputContract, markdown };
}

function readContractForm() {
  return { id: $('[data-contract-id]').value.trim(), name: $('[data-contract-name]').value.trim(), schema: JSON.parse($('[data-contract-schema]').value) };
}

function readCliProfileForm() {
  return { id: $('[data-cli-id]').value.trim(), name: $('[data-cli-name]').value.trim(), profile: { command: $('[data-cli-command]').value.trim(), args: csv($('[data-cli-args]').value), timeoutMs: Number($('[data-cli-timeout]').value), maxBytes: Number($('[data-cli-bytes]').value), allowedOrigins: csv($('[data-cli-origins]').value) } };
}

async function renderConfiguration() {
  const [workflows, prompts, templates, contracts, cliProfiles, providers] = await Promise.all([api.workflows(), api.prompts(), api.templates(), api.contracts(), api.cliProfiles(), api.providers()]);
  const tabItems = state.configurationTab === 'workflows' ? workflows : state.configurationTab === 'prompts' ? prompts : state.configurationTab === 'contracts' ? contracts : cliProfiles;
  const creating = state.configurationCreating === state.configurationTab;
  const selectedId = creating ? null : (tabItems.some(item => item.id === state.selected.configuration) ? state.selected.configuration : tabItems[0]?.id);
  state.selected.configuration = selectedId;
  const createLabel = state.configurationTab === 'workflows' ? 'Créer un workflow' : state.configurationTab === 'prompts' ? 'Créer un prompt' : state.configurationTab === 'contracts' ? 'Créer un contrat' : 'Créer un profil CLI';
  const tabLabel = state.configurationTab === 'workflows' ? 'Workflows' : state.configurationTab === 'prompts' ? 'Prompts' : state.configurationTab === 'contracts' ? 'Contrats' : 'Profils CLI';
  list.innerHTML = listHeader('Configuration', iconControl(createLabel, 'plus', 'data-new-configuration')) + `<nav class="tabs list-tabs" aria-label="Type de configuration"><button class="${state.configurationTab === 'workflows' ? 'active' : ''}" type="button" data-configuration-tab="workflows">Workflows</button><button class="${state.configurationTab === 'prompts' ? 'active' : ''}" type="button" data-configuration-tab="prompts">Prompts</button><button class="${state.configurationTab === 'contracts' ? 'active' : ''}" type="button" data-configuration-tab="contracts">Contrats</button><button class="${state.configurationTab === 'cli' ? 'active' : ''}" type="button" data-configuration-tab="cli">Profils CLI</button></nav><div class="section-label">${tabLabel}</div>${tabItems.map(item => `<button class="list-row ${item.id === selectedId ? 'active' : ''}" type="button" data-configuration-select="${item.id}"><span class="row-top"><strong>${esc(item.name ?? item.id)}</strong>${state.configurationTab === 'workflows' ? `<span class="row-count">${item.steps.length}</span>` : ''}</span><span class="row-meta">${state.configurationTab === 'prompts' ? `Étape ${esc(item.ownerStep)}` : state.configurationTab === 'workflows' ? `${item.steps.length} étapes · ${item.activeVersionId ? 'actif' : 'brouillon'}` : `${item.versions.length} versions · ${item.activeVersionId ? 'actif' : 'brouillon'}`}</span></button>`).join('')}`;
  if (state.configurationTab === 'prompts') {
    const source = creating ? { id: '', name: '', ownerStep: '', outputContract: '', markdown: '', draftHash: null, activeVersionId: null, versions: [] } : (selectedId ? await api.getPrompt(selectedId) : null);
    if (!source) detail.innerHTML = emptyState('Aucun prompt', 'Créez le premier prompt pour écrire ses instructions.');
    else {
      const prompt = state.configurationDraft ?? source;
      detail.innerHTML = `<div class="detail-inner"><header class="inspect-head"><div><h2>${creating ? 'Nouveau prompt' : esc(prompt.name)}</h2><p>${creating ? 'Le prompt sera enregistré comme fichier Markdown.' : `config/prompts/${esc(prompt.id)}/draft.md`}</p></div><div class="detail-actions"><button class="btn primary" type="button" data-save-prompt>Enregistrer</button>${creating ? '' : iconControl('Créer une version', 'versions', 'data-version-prompt')}</div></header><section class="panel"><div class="form-grid"><label class="field"><span>Identifiant</span><input value="${esc(prompt.id)}" data-prompt-id ${creating ? '' : 'readonly'}></label><label class="field"><span>Nom</span><input value="${esc(prompt.name)}" data-prompt-name></label><label class="field"><span>Étape propriétaire</span><input value="${esc(prompt.ownerStep)}" data-prompt-owner placeholder="analyse"></label><label class="field"><span>Contrat de sortie</span><select data-prompt-contract><option value="">Aucun</option>${contracts.map(contract => `<option value="${esc(contract.id)}" ${contractId(prompt.outputContract) === contract.id ? 'selected' : ''}>${esc(contract.name ?? contract.id)}</option>`).join('')}</select></label><label class="field span-2"><span>Instructions</span><textarea data-prompt-body>${esc(promptBody(prompt.markdown))}</textarea></label></div></section>${creating ? '' : `<section class="panel"><div class="section-label">Versions</div>${prompt.versions.length ? [...prompt.versions].reverse().map(version => `<div class="version-row"><span><strong>${esc(version.id)}</strong><small>${formatDate(version.createdAt)}</small></span>${prompt.activeVersionId === version.id ? '<span class="version-active">Version utilisée par les futurs runs</span>' : `<button class="btn compact" type="button" data-activate-version="${version.id}">Activer</button>`}</div>`).join('') : '<p class="muted">Enregistrez puis créez une première version.</p>'}</section>`}</div>`;
      const readPrompt = readPromptForm;
      rememberConfigurationDraft(source, readPrompt);
      $('[data-save-prompt]')?.addEventListener('click', async event => { const id = $('[data-prompt-id]').value.trim(); const draft = readPrompt(); const result = await perform(event.currentTarget, () => api.savePrompt(id, draft.markdown, creating ? null : source.draftHash), 'Prompt enregistré sur disque.'); if (result.ok) { state.configurationCreating = null; state.selected.configuration = id; await render(); } });
      $('[data-version-prompt]')?.addEventListener('click', async event => { const result = await perform(event.currentTarget, async () => { const draft = readPrompt(); const saved = await api.savePrompt(prompt.id, draft.markdown, source.draftHash); return api.createPromptVersion(prompt.id, saved.hash); }, 'Version immuable créée.'); if (result.ok) await render(); });
      bindAll('[data-activate-version]', async button => { if (!window.confirm('Utiliser cette version pour les futurs runs ?')) return; const result = await perform(button, () => api.activatePrompt(prompt.id, button.dataset.activateVersion), 'Version activée.'); if (result.ok) await render(); });
    }
    bindAll('[data-configuration-tab]', button => { state.configurationTab = button.dataset.configurationTab; state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = null; render(); });
    bindAll('[data-configuration-select]', button => { state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = button.dataset.configurationSelect; render(); });
    $('[data-new-configuration]')?.addEventListener('click', () => { state.configurationCreating = 'prompts'; state.configurationDraft = null; state.selected.configuration = null; render(); });
    return;
  }
  if (state.configurationTab === 'contracts') {
    const source = creating ? { id: '', name: '', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {}, additionalProperties: false }, draftHash: null, activeVersionId: null, versions: [] } : (selectedId ? await api.getContract(selectedId) : null);
    if (!source) detail.innerHTML = emptyState('Aucun contrat', 'Créez le premier contrat pour décrire une sortie.');
    else {
      const contract = state.configurationDraft ?? source;
      detail.innerHTML = `<div class="detail-inner"><header class="inspect-head"><div><h2>${creating ? 'Nouveau contrat' : esc(contract.name)}</h2><p>${creating ? 'Le contrat sera enregistré comme schéma JSON.' : `config/contracts/${esc(contract.id)}.schema.json`}</p></div><div class="detail-actions"><button class="btn primary" type="button" data-save-contract>Enregistrer</button>${creating ? '' : iconControl('Créer une version', 'versions', 'data-version-contract')}</div></header><section class="panel"><div class="form-grid"><label class="field"><span>Identifiant</span><input value="${esc(contract.id)}" data-contract-id ${creating ? '' : 'readonly'}></label><label class="field"><span>Nom</span><input value="${esc(contract.name)}" data-contract-name></label><label class="field span-2"><span>Schéma JSON</span><textarea class="code-field" data-contract-schema spellcheck="false">${esc(jsonText(contract.schema))}</textarea></label></div></section>${creating ? '' : `<section class="panel"><div class="section-label">Versions</div>${contract.versions.length ? [...contract.versions].reverse().map(version => `<div class="version-row"><span><strong>${esc(version.id)}</strong><small>${formatDate(version.createdAt)}</small></span>${contract.activeVersionId === version.id ? '<span class="version-active">Version utilisée par les futurs runs</span>' : `<button class="btn compact" type="button" data-activate-contract="${version.id}">Activer</button>`}</div>`).join('') : '<p class="muted">Enregistrez puis créez une première version.</p>'}</section>`}</div>`;
      const readContract = () => {
        try { return readContractForm(); } catch { throw new Error('Le schéma JSON est invalide.'); }
      };
      rememberConfigurationDraft(source, readContract);
      $('[data-save-contract]')?.addEventListener('click', async event => { const result = await perform(event.currentTarget, () => { const data = readContract(); return api.saveContract(data.id, data, creating ? null : source.draftHash); }, 'Contrat enregistré sur disque.'); if (result.ok) { state.configurationCreating = null; state.selected.configuration = result.value.id; await render(); } });
      $('[data-version-contract]')?.addEventListener('click', async event => { const result = await perform(event.currentTarget, async () => { const data = readContract(); const saved = await api.saveContract(data.id, data, source.draftHash); return api.createContractVersion(data.id, saved.draftHash); }, 'Version immuable créée.'); if (result.ok) await render(); });
      bindAll('[data-activate-contract]', async button => { if (!window.confirm('Utiliser cette version pour les futurs runs ?')) return; const result = await perform(button, () => api.activateContract(contract.id, button.dataset.activateContract), 'Version activée.'); if (result.ok) await render(); });
    }
    bindAll('[data-configuration-tab]', button => { state.configurationTab = button.dataset.configurationTab; state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = null; render(); });
    bindAll('[data-configuration-select]', button => { state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = button.dataset.configurationSelect; render(); });
    $('[data-new-configuration]')?.addEventListener('click', () => { state.configurationCreating = 'contracts'; state.configurationDraft = null; state.selected.configuration = null; render(); });
    return;
  }
  if (state.configurationTab === 'cli') {
    const source = creating ? { id: '', name: '', profile: { command: '', args: [], timeoutMs: 1000, maxBytes: 1024 * 1024, allowedOrigins: [] }, draftHash: null, activeVersionId: null, versions: [] } : (selectedId ? await api.getCliProfile(selectedId) : null);
    if (!source) detail.innerHTML = emptyState('Aucun profil CLI', 'Créez le premier profil pour autoriser une commande bornée.');
    else {
      const profile = state.configurationDraft ?? source;
      detail.innerHTML = `<div class="detail-inner"><header class="inspect-head"><div><h2>${creating ? 'Nouveau profil CLI' : esc(profile.name)}</h2><p>${creating ? 'Le profil sera enregistré comme configuration bornée.' : `config/cli-profiles/${esc(profile.id)}.json`}</p></div><div class="detail-actions"><button class="btn primary" type="button" data-save-cli-profile>Enregistrer</button>${creating ? '' : iconControl('Créer une version', 'versions', 'data-version-cli-profile')}</div></header><section class="panel"><div class="form-grid"><label class="field"><span>Identifiant</span><input value="${esc(profile.id)}" data-cli-id ${creating ? '' : 'readonly'}></label><label class="field"><span>Nom</span><input value="${esc(profile.name)}" data-cli-name></label><label class="field span-2"><span>Commande</span><input value="${esc(profile.profile.command)}" data-cli-command placeholder="/chemin/vers/commande"></label><label class="field span-2"><span>Arguments</span><input value="${esc(profile.profile.args.join(', '))}" data-cli-args placeholder="--profil, audit"></label><label class="field"><span>Timeout en ms</span>${numberField(profile.profile.timeoutMs, 'data-cli-timeout')}</label><label class="field"><span>Sortie maximum en octets</span>${numberField(profile.profile.maxBytes, 'data-cli-bytes')}</label><label class="field span-2"><span>Origines autorisées</span><input value="${esc(profile.profile.allowedOrigins.join(', '))}" data-cli-origins placeholder="https://exemple.test"></label></div></section>${creating ? '' : `<section class="panel"><div class="section-label">Versions</div>${profile.versions.length ? [...profile.versions].reverse().map(version => `<div class="version-row"><span><strong>${esc(version.id)}</strong><small>${formatDate(version.createdAt)}</small></span>${profile.activeVersionId === version.id ? '<span class="version-active">Version utilisée par les futurs runs</span>' : `<button class="btn compact" type="button" data-activate-cli-profile="${version.id}">Activer</button>`}</div>`).join('') : '<p class="muted">Enregistrez puis créez une première version.</p>'}</section>`}</div>`;
      const readCliProfile = readCliProfileForm;
      rememberConfigurationDraft(source, readCliProfile);
      $('[data-save-cli-profile]')?.addEventListener('click', async event => { const result = await perform(event.currentTarget, () => { const data = readCliProfile(); return api.saveCliProfile(data.id, data, creating ? null : source.draftHash); }, 'Profil CLI enregistré sur disque.'); if (result.ok) { state.configurationCreating = null; state.selected.configuration = result.value.id; await render(); } });
      $('[data-version-cli-profile]')?.addEventListener('click', async event => { const result = await perform(event.currentTarget, async () => { const data = readCliProfile(); const saved = await api.saveCliProfile(data.id, data, source.draftHash); return api.createCliProfileVersion(data.id, saved.draftHash); }, 'Version immuable créée.'); if (result.ok) await render(); });
      bindAll('[data-activate-cli-profile]', async button => { if (!window.confirm('Utiliser cette version pour les futurs runs ?')) return; const result = await perform(button, () => api.activateCliProfile(profile.id, button.dataset.activateCliProfile), 'Version activée.'); if (result.ok) await render(); });
    }
    bindAll('[data-configuration-tab]', button => { state.configurationTab = button.dataset.configurationTab; state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = null; render(); });
    bindAll('[data-configuration-select]', button => { state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = button.dataset.configurationSelect; render(); });
    $('[data-new-configuration]')?.addEventListener('click', () => { state.configurationCreating = 'cli'; state.configurationDraft = null; state.selected.configuration = null; render(); });
    return;
  }
  const source = creating ? { id: '', name: '', version: 1, hash: null, activeVersionId: null, versions: [], limits: { urls: 50, minutes: 3, megabytes: 25, dollars: 2 }, outputTemplateId: templates[0]?.id ?? '', steps: [{ id: 'premiere-etape', kind: 'deterministic', dependsOn: [], inputRefs: [], outputRefs: ['resultat'], implementation: '', timeoutMs: 1000, budget: 0, actor: '', provider: '', model: '', promptRef: '', profile: '' }] } : workflows.find(item => item.id === selectedId);
  if (!source) { detail.innerHTML = emptyState('Aucun workflow', 'Créez le premier workflow pour définir ses étapes.'); }
  else {
    const workflow = state.configurationDraft ?? source;
    const limits = { urls: 50, minutes: 3, megabytes: 25, dollars: 2, ...(workflow.limits ?? {}) };
    const template = templates.find(item => item.id === workflow.outputTemplateId) ?? templates[0];
    const action = `<button class="btn primary" type="button" data-save-workflow>Enregistrer</button>${creating ? '' : iconControl('Créer une version', 'versions', 'data-version-workflow')}<button class="btn" type="button" data-sync-configuration>Synchroniser</button>`;
    detail.innerHTML = `<div class="detail-inner"><header class="inspect-head"><div><h2>${creating ? 'Nouveau workflow' : esc(workflow.name || workflow.id)}</h2><p>Centre de configuration</p></div><div class="detail-actions">${action}</div></header>
      <section class="panel"><div class="section-label">Workflow</div><div class="form-grid"><label class="field"><span>Identifiant</span><input value="${esc(workflow.id)}" data-workflow-id ${creating ? '' : 'readonly'}></label><label class="field"><span>Nom</span><input value="${esc(workflow.name ?? '')}" data-workflow-name></label><label class="field"><span>Template de sortie</span><span class="select-wrap"><select class="select-control" data-workflow-template>${templates.map(item => `<option value="${esc(item.id)}" ${item.id === (workflow.outputTemplateId ?? template?.id) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></span></label><label class="field"><span>Version</span>${numberField(workflow.version ?? 1, 'data-workflow-version')}</label></div></section>
      <section class="panel"><div class="section-label">Limites par défaut</div><div class="limit-grid"><label class="field"><span>URL</span>${numberField(limits.urls, 'data-limit="urls"')}</label><label class="field"><span>Minutes</span>${numberField(limits.minutes, 'data-limit="minutes"')}</label><label class="field"><span>Mo</span>${numberField(limits.megabytes, 'data-limit="megabytes"')}</label><label class="field"><span>USD</span>${numberField(limits.dollars, 'data-limit="dollars"')}</label></div></section>
      <div class="workflow-editor">${workflow.steps.map((step, index) => workflowStepEditor({ ...step, open: state.configurationOpenSteps.has(step.id), actor: step.actor ?? '', provider: step.provider ?? '', profile: step.profile ?? '' }, index, prompts, contracts, cliProfiles, providers.filter(provider => provider.kind === 'ai' && provider.configured && provider.enabled && provider.health === 'healthy'), state.configurationModels[step.provider] ?? [], templates, workflow.id)).join('')}</div><button class="btn" type="button" data-add-workflow-step>${icon('plus')} Ajouter une étape</button>
      <section class="panel"><div class="section-label">Templates de sortie</div><div class="template-list">${templates.map(item => `<div class="template-row"><span><strong>${esc(item.name)}</strong><small>${esc(item.id)} · ${item.versions.length} versions${item.activeVersionId ? ' · actif' : ''}</small></span><span class="template-actions">${item.activeVersionId ? '' : `<button class="btn compact" type="button" data-activate-template="${esc(item.id)}">Activer</button>`}<button class="btn compact" type="button" data-edit-template="${esc(item.id)}">Modifier</button><button class="btn compact danger" type="button" data-delete-template="${esc(item.id)}">Supprimer</button></span></div>`).join('')}</div><div class="template-create"><input data-template-id placeholder="identifiant" aria-label="Identifiant du template"><input data-template-name placeholder="nom" aria-label="Nom du template"><input type="file" data-template-file accept=".html,.htm,.txt"><button class="btn" type="button" data-upload-template>Importer</button></div></section>
      ${creating ? '' : `<section class="panel"><div class="section-label">Versions</div>${workflow.versions.length ? [...workflow.versions].reverse().map(version => `<div class="version-row"><span><strong>${esc(version.id)}</strong><small>${formatDate(version.createdAt)}</small></span>${workflow.activeVersionId === version.id ? '<span class="version-active">Version active</span>' : `<button class="btn compact" type="button" data-activate-workflow="${version.id}">Activer</button>`}</div>`).join('') : '<p class="muted">Enregistrez puis créez une première version.</p>'}</section>`}
    </div>`;
    $('[data-add-workflow-step]')?.addEventListener('click', () => { const draft = readWorkflowForm(); draft.steps.push({ id: `etape-${draft.steps.length + 1}`, kind: 'deterministic', trigger: 'ready', dependsOn: draft.steps.length ? [draft.steps.at(-1).id] : [], inputRefs: draft.steps.length ? [draft.steps.at(-1).id] : [], outputRefs: ['resultat'], implementation: '', timeoutMs: 1000, budget: 0, approval: 'none', actor: '', provider: '', model: '', promptRef: '', profile: '' }); state.configurationDraft = { ...source, ...draft }; render(); });
    bindAll('[data-remove-workflow-step]', button => { const draft = readWorkflowForm(); const index = [...document.querySelectorAll('[data-remove-workflow-step]')].indexOf(button); draft.steps.splice(index, 1); state.configurationDraft = { ...source, ...draft }; render(); });
    $('[data-save-workflow]')?.addEventListener('click', async event => { const definition = readWorkflowForm(); const result = await perform(event.currentTarget, () => api.saveWorkflow(definition.id, definition, creating ? null : source.hash), 'Workflow enregistré sur disque.'); if (result.ok) { state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = definition.id; await render(); } });
    $('[data-version-workflow]')?.addEventListener('click', async event => { const definition = readWorkflowForm(); const result = await perform(event.currentTarget, async () => { const saved = await api.saveWorkflow(definition.id, definition, source.hash); return api.createWorkflowVersion(definition.id, saved.hash); }, 'Version immuable créée.'); if (result.ok) { state.configurationDraft = null; await render(); } });
    bindAll('[data-activate-workflow]', async button => { if (!window.confirm('Utiliser cette version pour les futurs runs ?')) return; const result = await perform(button, () => api.activateWorkflow(source.id, button.dataset.activateWorkflow), 'Version activée.'); if (result.ok) await render(); });
    $('[data-sync-configuration]')?.addEventListener('click', () => { state.configurationDraft = null; notify('Fichiers locaux synchronisés.'); render(); });
    document.querySelectorAll('[data-step-provider]').forEach(select => select.addEventListener('change', async event => {
      const providerId = event.currentTarget.value;
      if (!providerId || state.configurationModels[providerId]) { render(); return; }
      try { state.configurationModels[providerId] = await api.providerModels(providerId); render(); } catch (error) { notify(error.message); }
    }));
    bindAll('[data-open-workflow-resource]', async (button, event) => {
      event.preventDefault();
      event.stopPropagation();
      await perform(button, () => api.openWorkflowResource(button.dataset.workflowId, { stepId: button.dataset.stepId, field: button.dataset.resourceField, reference: button.dataset.resourceReference }), 'Fichier affiché dans Finder.');
    });
    document.querySelectorAll('[data-workflow-step] .step-main').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const scrollTop = detail.scrollTop;
      const scrollLeft = detail.scrollLeft;
      const pageTop = document.scrollingElement?.scrollTop ?? 0;
      const pageLeft = document.scrollingElement?.scrollLeft ?? 0;
      const step = button.closest('[data-workflow-step]');
      const id = step.querySelector('[data-step-field="id"]')?.value ?? '';
      const open = !step.classList.contains('is-open');
      document.querySelectorAll('[data-workflow-step]').forEach(other => {
        if (other === step) return;
        other.classList.remove('is-open');
        other.querySelector('.step-main')?.setAttribute('aria-expanded', 'false');
      });
      step.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
      state.configurationOpenSteps.clear();
      if (open) state.configurationOpenSteps.add(id);
      const restore = () => {
        detail.scrollTop = scrollTop;
        detail.scrollLeft = scrollLeft;
        if (document.scrollingElement) {
          document.scrollingElement.scrollTop = pageTop;
          document.scrollingElement.scrollLeft = pageLeft;
        }
      };
      requestAnimationFrame(restore);
      setTimeout(restore, 50);
    }));
    document.querySelectorAll('[data-step-field="kind"]').forEach(select => select.addEventListener('change', () => render()));
    bindAll('[data-activate-template]', async button => { const item = templates.find(template => template.id === button.dataset.activateTemplate); const version = item?.versions.at(-1); if (!version) { notify('Créez une version avant activation.'); return; } const result = await perform(button, () => api.activateTemplate(item.id, version.id), 'Template activé.'); if (result.ok) await render(); });
    bindAll('[data-delete-template]', async button => { if (!window.confirm('Supprimer ce template local ?')) return; const result = await perform(button, () => api.deleteTemplate(button.dataset.deleteTemplate), 'Template supprimé.'); if (result.ok) await render(); });
    $('[data-upload-template]')?.addEventListener('click', async event => { const file = $('[data-template-file]').files[0]; const id = $('[data-template-id]').value.trim(); const name = $('[data-template-name]').value.trim() || file?.name || id; if (!file || !id) { notify('Choisissez un fichier et un identifiant.'); return; } const content = await file.text(); const existing = templates.find(item => item.id === id); const result = await perform(event.currentTarget, () => api.saveTemplate(id, { name, content }, existing?.draftHash ?? null), 'Template importé sur disque.'); if (result.ok) { await api.createTemplateVersion(id, result.value.draftHash); await render(); } });
    bindAll('[data-edit-template]', button => { const item = templates.find(template => template.id === button.dataset.editTemplate); if (item) { $('[data-template-id]').value = item.id; $('[data-template-name]').value = item.name; notify('Choisissez un fichier pour remplacer le brouillon.'); } });
    rememberConfigurationDraft(source, readWorkflowForm);
  }
  $('[data-new-configuration]')?.addEventListener('click', () => { state.configurationCreating = 'workflows'; state.configurationDraft = null; state.selected.configuration = null; render(); });
  bindAll('[data-configuration-tab]', button => { state.configurationTab = button.dataset.configurationTab; state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = null; render(); });
  bindAll('[data-configuration-select]', button => { state.configurationCreating = null; state.configurationDraft = null; state.selected.configuration = button.dataset.configurationSelect; render(); });
}

async function renderProviders() {
  const providers = await api.providers();
  list.innerHTML = listHeader('Providers');
  if (!providers.length) {
    detail.innerHTML = emptyState('Aucun provider', 'Le registre local est vide.');
    return;
  }
  detail.innerHTML = `<div class="detail-inner provider-page"><header class="inspect-head"><div><h2>Providers</h2></div></header><section class="connection-list">${providers.map(provider => { const isDataForSeo = provider.id === 'dataforseo'; const label = isDataForSeo ? 'Identifiants API' : 'Clé API'; const value = provider.configured ? '••••••••' : ''; const control = isDataForSeo ? `<div class="dataforseo-fields"><input type="text" name="dataforseo-api-login" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore="true" data-lpignore="true" data-bwignore="true" placeholder="Login API (email)" aria-label="Login API DataForSEO" data-dataforseo-login><input type="password" name="dataforseo-api-password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore="true" data-lpignore="true" data-bwignore="true" placeholder="API password" aria-label="API password DataForSEO" data-dataforseo-password></div>` : `<input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore="true" data-lpignore="true" placeholder="${label}" aria-label="${label} ${esc(provider.name)}" value="${value}" data-masked="${provider.configured}" data-provider-secret="${esc(provider.id)}">`; return `<div class="provider-row${isDataForSeo ? ' dataforseo-row' : ''}"><div class="connection-name"><strong>${esc(provider.name)}</strong></div><div class="provider-key">${control}</div><button class="icon-control compact-icon" type="button" aria-label="Enregistrer ${label.toLowerCase()} ${esc(provider.name)}" title="Enregistrer" data-save-provider="${esc(provider.id)}">${icon('save')}</button><button class="connection-toggle ${provider.enabled ? 'on' : ''}" type="button" aria-label="${provider.enabled ? 'Désactiver' : 'Activer'} ${esc(provider.name)}" aria-pressed="${provider.enabled}" data-toggle-provider="${esc(provider.id)}"><span></span></button></div>`; }).join('')}</section></div>`;
  document.querySelectorAll('[data-dataforseo-login], [data-dataforseo-password]').forEach(input => {
    const focusInput = event => { event.stopPropagation(); input.focus({ preventScroll: true }); };
    input.addEventListener('pointerdown', focusInput);
    input.addEventListener('click', focusInput);
  });
  document.querySelectorAll('[data-provider-secret]').forEach(input => {
    const focusInput = event => { event.stopPropagation(); input.focus({ preventScroll: true }); };
    input.addEventListener('pointerdown', focusInput);
    input.addEventListener('click', focusInput);
    input.addEventListener('focus', () => {
      if (input.dataset.masked !== 'true') return;
      input.value = '';
      input.dataset.masked = 'false';
    });
  });
  bindAll('[data-save-provider]', async button => {
    const id = button.dataset.saveProvider;
    const input = document.querySelector(`[data-provider-secret="${id}"]`);
    if (id === 'dataforseo') {
      const login = document.querySelector('[data-dataforseo-login]');
      const password = document.querySelector('[data-dataforseo-password]');
      if (!login.value.trim()) { notify('Saisissez le login API.'); login.focus(); return; }
      if (!password.value) { notify('Saisissez l’API password.'); password.focus(); return; }
      const secret = JSON.stringify({ login: login.value.trim(), password: password.value });
      const checked = await perform(button, () => api.testProviderSecret(id, secret));
      if (!checked.ok || checked.value.health !== 'healthy') { notify(checked.value?.lastErrorCode?.startsWith('DATAFORSEO_') ? 'DataForSEO refuse ces identifiants API.' : 'DataForSEO est momentanément inaccessible.'); return; }
      const result = await perform(button, () => api.saveSecret(id, secret), 'Identifiants enregistrés');
      if (result.ok) { password.value = ''; await api.testProvider(id).catch(() => {}); await render(); }
      return;
    }
    if (input.dataset.masked === 'true') { notify('Clé déjà enregistrée.'); return; }
    if (!input.value.trim()) { notify('Saisissez une clé.'); input.focus(); return; }
    const secret = input.value;
    const checked = await perform(button, () => api.testProviderSecret(id, secret));
    if (!checked.ok || checked.value.health !== 'healthy') { notify('Clé non valide'); await render(); return; }
    const result = await perform(button, () => api.saveSecret(id, secret), 'Clé enregistrée');
    if (result.ok) { await api.testProvider(id).catch(() => {}); await render(); }
  });
  bindAll('[data-toggle-provider]', async button => {
    const provider = providers.find(item => item.id === button.dataset.toggleProvider);
    const result = await perform(button, () => api.setEnabled(provider.id, !provider.enabled), provider.enabled ? 'Provider désactivé.' : 'Provider activé.');
    if (result.ok) await render();
  });
}

async function renderInternet() {
  const providers = (await api.providers()).filter(provider => provider.kind === 'domain');
  list.innerHTML = '';
  const result = state.internetResult;
  const registrarConfig = state.internetConfigOpen ? `<section class="internet-config-panel"><div class="section-label">Registrars</div>${providers.map(provider => `<button class="connection-row" type="button" data-internet-provider="${esc(provider.id)}"><strong>${esc(provider.name)}</strong><span>${badge(provider.health)}</span><small>${provider.enabled ? 'Actif' : 'Inactif'} · ouvrir Providers pour configurer</small></button>`).join('')}</section>` : '';
  const rows = result?.candidates?.length ? result.candidates.map(candidate => `<div class="domain-row"><strong>${esc(candidate.domain)}</strong><span>${candidate.availability === 'unknown' ? 'Disponibilité à vérifier' : esc(candidate.availability)}</span><small>${esc(candidate.source)}</small></div>`).join('') : '';
  detail.innerHTML = `<div class="detail-inner internet-page"><header class="inspect-head"><div><h2>Internet</h2></div><div class="detail-actions">${iconControl(state.internetConfigOpen ? 'Fermer les connexions Internet' : 'Afficher les connexions Internet', 'config', 'data-toggle-internet-config')}</div></header><form class="internet-search" data-internet-form><label><span class="sr-only">Nom de domaine</span><input name="query" autocomplete="off" placeholder="Nom de domaine" value="${esc(state.internetQuery)}"></label><button class="icon-control primary" type="submit" aria-label="Rechercher" title="Rechercher" data-internet-submit>${icon('search')}</button></form>${registrarConfig}${rows ? `<section class="panel">${rows}</section>` : ''}</div>`;
  const submitInternet = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[data-internet-submit]');
    const query = form.querySelector('input[name="query"]').value.trim();
    if (!query) return;
    state.internetQuery = query;
    const result = await perform(button, () => api.internetSearch(query), 'Recherche terminée.');
    if (result.ok) { state.internetResult = result.value; await render(); }
  };
  $('[data-internet-form]')?.addEventListener('submit', submitInternet);
  $('[data-toggle-internet-config]')?.addEventListener('click', () => { state.internetConfigOpen = !state.internetConfigOpen; render(); });
}

async function renderNow({ preserveScroll = true } = {}) {
      const scroll = preserveScroll ? { list: list.scrollTop, detail: pointerScroll?.top ?? detail.scrollTop, pageTop: pointerScroll?.pageTop ?? (document.scrollingElement?.scrollTop ?? 0), pageLeft: pointerScroll?.pageLeft ?? (document.scrollingElement?.scrollLeft ?? 0) } : null;
  renderNav();
  document.body.dataset.view = state.view;
  loading();
  try {
    if (state.view === 'inbox') await renderInbox();
    else if (state.view === 'runs') await renderRuns();
    else if (state.view === 'dossiers') await renderDossiers();
    else if (state.view === 'configuration') await renderConfiguration();
    else if (state.view === 'providers') await renderProviders();
    else await renderInternet();
  } catch (error) {
    showError(error);
  } finally {
    if (scroll) {
      list.scrollTop = scroll.list;
      detail.scrollTop = scroll.detail;
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = scroll.pageTop;
        document.scrollingElement.scrollLeft = scroll.pageLeft;
      }
      pointerScroll = null;
    }
  }
}

function render(options) {
  const next = renderQueue.then(() => renderNow(options));
  renderQueue = next.catch(() => {});
  return next;
}

$('#app').addEventListener('click', event => {
  const provider = event.target.closest('[data-internet-provider]');
  if (provider) {
    go('providers', provider.dataset.internetProvider);
    return;
  }
  const button = event.target.closest('[data-view]');
  if (button) go(button.dataset.view);
});

$('#brand').addEventListener('click', () => go('inbox'));
render();
