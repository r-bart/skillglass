import type { ArtifactObservation, ArtifactRef, FileSystemPort, TreeContentEntry } from "./types.js"
import { OperationValidationError } from "./errors.js"

/** Routes file and tree artifacts while preserving one engine-wide mutation lock. */
export class ArtifactFileSystemRouter implements FileSystemPort {
  readonly #files: FileSystemPort
  readonly #trees: FileSystemPort

  constructor(files: FileSystemPort, trees: FileSystemPort) {
    this.#files = files
    this.#trees = trees
  }

  #port(reference: ArtifactRef): FileSystemPort {
    return reference.kind === "file" ? this.#files : this.#trees
  }

  #matching(source: ArtifactRef, destination: ArtifactRef): FileSystemPort {
    if (source.kind !== destination.kind) {
      throw new OperationValidationError("Operation artifacts must have matching kinds")
    }
    return this.#port(source)
  }

  authorize(reference: ArtifactRef, access: "read" | "write"): Promise<void> {
    return this.#port(reference).authorize(reference, access)
  }

  observe(reference: ArtifactRef): Promise<ArtifactObservation> {
    return this.#port(reference).observe(reference)
  }

  copyExclusive(source: ArtifactRef, destination: ArtifactRef): Promise<void> {
    return this.#matching(source, destination).copyExclusive(source, destination)
  }

  writeFileExclusive(destination: ArtifactRef, content: string): Promise<void> {
    return this.#port(destination).writeFileExclusive(destination, content)
  }

  writeTreeExclusive(destination: ArtifactRef, entries: readonly TreeContentEntry[]): Promise<void> {
    return this.#port(destination).writeTreeExclusive(destination, entries)
  }

  replace(source: ArtifactRef, destination: ArtifactRef, mode: "create" | "update"): Promise<void> {
    return this.#matching(source, destination).replace(source, destination, mode)
  }

  removeExact(reference: ArtifactRef, expectedHash: string): Promise<boolean> {
    return this.#port(reference).removeExact(reference, expectedHash)
  }
}
