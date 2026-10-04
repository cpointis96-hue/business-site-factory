import { WorkflowValidationError } from '../core/errors.mjs';

export function validateWorkflowDefinition(definition) {
  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.steps) || !definition.id) throw new WorkflowValidationError('Workflow invalide.');
  if (definition.steps.length === 0) throw new WorkflowValidationError('Le workflow doit contenir au moins une étape.');
  const ids = new Set();
  for (const step of definition.steps) {
    if (!step.id || ids.has(step.id)) throw new WorkflowValidationError('Identifiant d’étape dupliqué.');
    ids.add(step.id);
    if (!['deterministic', 'ai'].includes(step.kind)) throw new WorkflowValidationError('Type d’étape invalide.');
    if (!step.implementation) throw new WorkflowValidationError('Implémentation d’étape manquante.');
    if (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 900000) throw new WorkflowValidationError('Timeout d’étape invalide.');
    if (typeof step.budget !== 'number' || step.budget < 0) throw new WorkflowValidationError('Budget d’étape invalide.');
    if (step.maxOutputTokens !== undefined && (!Number.isInteger(step.maxOutputTokens) || step.maxOutputTokens < 1 || step.maxOutputTokens > 16000)) throw new WorkflowValidationError('Limite de sortie invalide.');
    if (step.kind === 'ai' && (!step.promptRef || !step.model)) throw new WorkflowValidationError('Prompt et modèle obligatoires pour une étape IA.');
    if (step.model && (typeof step.model !== 'string' || step.model.length > 160)) throw new WorkflowValidationError('Modèle d’étape invalide.');
    for (const dep of step.dependsOn ?? []) if (!definition.steps.some(candidate => candidate.id === dep)) throw new WorkflowValidationError('Dépendance absente.');
    for (const output of step.outputRefs ?? []) if (definition.steps.some(candidate => candidate !== step && (candidate.outputRefs ?? []).includes(output))) throw new WorkflowValidationError('Sortie ambiguë.');
  }
  const visiting = new Set(); const visited = new Set();
  function visit(id) { if (visiting.has(id)) throw new WorkflowValidationError('Cycle détecté.'); if (visited.has(id)) return; visiting.add(id); const step = definition.steps.find(item => item.id === id); for (const dep of step.dependsOn ?? []) visit(dep); visiting.delete(id); visited.add(id); }
  for (const step of definition.steps) visit(step.id);
  return definition;
}
