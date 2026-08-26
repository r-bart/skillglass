import type {
  InspectInstallationInput,
  InstallationDetailDto,
  InventoryPageDto,
  InventoryQuery,
} from "./inventory.js"
import type { AckDto } from "./primitives.js"
import type {
  ConfirmOperationInput,
  LocalSourceSelectionDto,
  OperationPlanDto,
  OperationHistoryDto,
  OperationRequestDto,
  OperationResultDto,
  SelectLocalSourceInput,
  UndoOperationInput,
} from "./operations.js"
import type {
  InventoryChangedEvent,
  OperationCompletedEvent,
  OperationProgressEvent,
  RootsChangedEvent,
} from "./events.js"
import type {
  ApproveRootsInput,
  ApprovedRootDto,
  OnboardingStateDto,
  RootCandidateDto,
  SelectAdditionalRootInput,
} from "./roots.js"

export type Unsubscribe = () => void

/** The only renderer-facing API. Implementations must validate both sides of IPC. */
export interface ForgeBridge {
  onboarding: {
    state(): Promise<OnboardingStateDto>
    proposedRoots(): Promise<RootCandidateDto[]>
    selectAdditionalRoot(
      input: SelectAdditionalRootInput,
    ): Promise<RootCandidateDto | null>
    selectProject(): Promise<OnboardingStateDto>
    approveRoots(input: ApproveRootsInput): Promise<ApprovedRootDto[]>
  }
  inventory: {
    list(input: InventoryQuery): Promise<InventoryPageDto>
    inspect(input: InspectInstallationInput): Promise<InstallationDetailDto>
    openEntry(input: InspectInstallationInput): Promise<AckDto>
  }
  operations: {
    selectLocalSource(
      input: SelectLocalSourceInput,
    ): Promise<LocalSourceSelectionDto | null>
    plan(input: OperationRequestDto): Promise<OperationPlanDto>
    confirm(input: ConfirmOperationInput): Promise<OperationResultDto>
    undo(input: UndoOperationInput): Promise<OperationResultDto>
    history(): Promise<OperationHistoryDto>
    refreshUpdates(): Promise<AckDto>
  }
  events: {
    onRootsChanged(listener: (event: RootsChangedEvent) => void): Unsubscribe
    onInventoryChanged(
      listener: (event: InventoryChangedEvent) => void,
    ): Unsubscribe
    onOperationProgress(
      listener: (event: OperationProgressEvent) => void,
    ): Unsubscribe
    onOperationCompleted(
      listener: (event: OperationCompletedEvent) => void,
    ): Unsubscribe
  }
}
