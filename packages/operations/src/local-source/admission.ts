import { inspectDirectorySource } from "./directory.js"
import type { AdmittedLocalSource, LocalSourceAdmissionPort, LocalSourceKind } from "./types.js"
import { inspectZipSource } from "./zip.js"

export class FileSystemLocalSourceAdmission implements LocalSourceAdmissionPort {
  async inspect(kind: LocalSourceKind, path: string, observedAt: string): Promise<AdmittedLocalSource> {
    return kind === "directory"
      ? inspectDirectorySource(path, observedAt)
      : inspectZipSource(path, observedAt)
  }
}
