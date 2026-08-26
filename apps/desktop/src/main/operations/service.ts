import type {
  ConfirmOperationInput,
  OperationHistoryDto,
  OperationPlanDto,
  OperationRequestDto,
  OperationResultDto,
  UndoOperationInput,
} from "@forge/contracts"
import type { ContentUpdateCoordinator } from "@forge/operations"

export class DesktopOperationService {
  readonly #contentUpdates: ContentUpdateCoordinator

  constructor(contentUpdates: ContentUpdateCoordinator) {
    this.#contentUpdates = contentUpdates
  }

  plan(input: OperationRequestDto): Promise<OperationPlanDto> {
    return this.#contentUpdates.plan(input)
  }

  confirm(input: ConfirmOperationInput): Promise<OperationResultDto> {
    return this.#contentUpdates.confirm(input.planId)
  }

  undo(input: UndoOperationInput): Promise<OperationResultDto> {
    return this.#contentUpdates.undo(input.journalId)
  }

  history(): Promise<OperationHistoryDto> {
    return Promise.resolve(this.#contentUpdates.history())
  }
}
