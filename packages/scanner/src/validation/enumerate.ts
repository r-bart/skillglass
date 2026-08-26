import { opendir, lstat, realpath } from "node:fs/promises"
import path from "node:path"

import { isIgnoredMetadata, validatePortableRelativePath } from "./portable-path.js"
import {
  LOCAL_SOURCE_LIMITS_V1,
  type DirectoryEnumeration,
  type LocalSourceFile,
  type ScannerFinding,
} from "./types.js"

function filesystemFinding(error: unknown, candidate: string): ScannerFinding {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN"
  return {
    code: code === "EACCES" || code === "EPERM" ? "SOURCE_ACCESS_DENIED" : "SOURCE_IO_ERROR",
    severity: "error",
    message: `Could not inspect local source (${code})`,
    path: candidate,
  }
}

/** Enumerates inert regular files only. It never opens or follows a link target. */
export async function enumerateSkillResources(root: string): Promise<DirectoryEnumeration> {
  const files: LocalSourceFile[] = []
  const ignoredEntries: string[] = []
  const findings: ScannerFinding[] = []
  let includedBytes = 0
  let directoryCount = 0
  let canonicalRoot = path.resolve(root)

  try {
    const rootStats = await lstat(root)
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      return { root: canonicalRoot, files, ignoredEntries, includedBytes, findings: [{ code: "SOURCE_ROOT_NOT_DIRECTORY", severity: "error", message: "Selected source must be a directory", path: root }] }
    }
    canonicalRoot = await realpath(root)
  } catch (error) {
    return { root: canonicalRoot, files, ignoredEntries, includedBytes, findings: [filesystemFinding(error, root)] }
  }

  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    directoryCount += 1
    if (directoryCount > LOCAL_SOURCE_LIMITS_V1.includedDirectories) {
      findings.push({ code: "DIRECTORY_COUNT_LIMIT", severity: "error", message: "Directory count exceeds local-source-v1" })
      return
    }
    let handle
    try {
      handle = await opendir(absoluteDirectory)
      for await (const entry of handle) {
        const rawRelative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`
        const portable = validatePortableRelativePath(rawRelative)
        findings.push(...portable.findings)
        if (portable.normalized === undefined) continue
        const relative = portable.normalized
        if (isIgnoredMetadata(relative)) {
          ignoredEntries.push(relative)
          continue
        }
        const absolute = path.join(absoluteDirectory, entry.name)
        let stats
        try {
          stats = await lstat(absolute)
        } catch (error) {
          findings.push(filesystemFinding(error, relative))
          continue
        }
        if (stats.isSymbolicLink()) {
          findings.push({ code: "SOURCE_LINK_REJECTED", severity: "error", message: "Links and junctions are not admitted", path: relative })
        } else if (stats.isDirectory()) {
          await visit(absolute, relative)
        } else if (stats.isFile()) {
          if (stats.size > LOCAL_SOURCE_LIMITS_V1.singleIncludedFileBytes) {
            findings.push({ code: "FILE_SIZE_LIMIT", severity: "error", message: "File exceeds local-source-v1", path: relative })
          }
          includedBytes += stats.size
          files.push({ path: relative, absolutePath: absolute, byteLength: stats.size, kind: relative === "SKILL.md" ? "entry" : "resource" })
          if (files.length > LOCAL_SOURCE_LIMITS_V1.includedRegularFiles) {
            findings.push({ code: "FILE_COUNT_LIMIT", severity: "error", message: "File count exceeds local-source-v1" })
            return
          }
          if (includedBytes > LOCAL_SOURCE_LIMITS_V1.directoryIncludedBytes) {
            findings.push({ code: "SOURCE_SIZE_LIMIT", severity: "error", message: "Source exceeds local-source-v1" })
            return
          }
        } else {
          findings.push({ code: "SOURCE_SPECIAL_ENTRY_REJECTED", severity: "error", message: "Only regular files and directories are admitted", path: relative })
        }
      }
    } catch (error) {
      findings.push(filesystemFinding(error, relativeDirectory || root))
    }
  }

  await visit(canonicalRoot, "")
  const normalized = new Set<string>()
  const collisionKeys = new Set<string>()
  for (const file of files) {
    const portable = validatePortableRelativePath(file.path)
    const key = portable.collisionKey
    if (normalized.has(file.path) || (key !== undefined && collisionKeys.has(key))) {
      findings.push({ code: "PATH_COLLISION", severity: "error", message: "Source contains a portable path collision", path: file.path })
    }
    normalized.add(file.path)
    if (key !== undefined) collisionKeys.add(key)
  }
  files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  ignoredEntries.sort()
  return { root: canonicalRoot, files, ignoredEntries, findings, includedBytes }
}
