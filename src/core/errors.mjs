export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', status = 500, details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ConflictError extends AppError {
  constructor(message = 'La ressource a changé depuis son chargement.', details = null) {
    super(message, { code: 'CONFLICT', status: 409, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Ressource introuvable.', details = null) {
    super(message, { code: 'NOT_FOUND', status: 404, details });
  }
}

export class PathViolationError extends AppError {
  constructor(message = 'Chemin local non autorisé.') {
    super(message, { code: 'PATH_VIOLATION', status: 400 });
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Données invalides.', details = null) {
    super(message, { code: 'VALIDATION_ERROR', status: 400, details });
  }
}

export class WorkflowValidationError extends ValidationError {
  constructor(message = 'Workflow invalide.', details = null) { super(message, details); this.code = 'WORKFLOW_INVALID'; }
}
