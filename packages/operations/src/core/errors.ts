export class OperationError extends Error {
  override readonly name: string = "OperationError"
}

export class OperationValidationError extends OperationError {
  override readonly name = "OperationValidationError"
}

export class OperationConflictError extends OperationError {
  override readonly name = "OperationConflictError"
}

export class OperationNotReadyError extends OperationError {
  override readonly name = "OperationNotReadyError"
}

export class OperationConcurrencyError extends OperationError {
  override readonly name = "OperationConcurrencyError"
}

/** Used by tests and process hosts to model termination after durable state. */
export class OperationInterruptedError extends OperationError {
  override readonly name = "OperationInterruptedError"
}
