import { useEffect, useRef } from "react"

import type { ForgeBridge, WorkspaceCloseState } from "@forge/contracts"

import type { Locale } from "./i18n.js"

export interface ReportedWorkspaceCloseState {
  readonly state: WorkspaceCloseState
  readonly revision: number
}

export function useWorkspaceCloseGuard(
  bridge: ForgeBridge["lifecycle"] | undefined,
  workspace: ReportedWorkspaceCloseState,
  locale: Locale,
): void {
  const current = useRef({ ...workspace, locale })
  current.current = { ...workspace, locale }

  useEffect(() => {
    if (bridge === undefined) return
    return bridge.onCloseRequested((request) => {
      const snapshot = current.current
      void bridge.respondToClose({
        requestId: request.requestId,
        revision: snapshot.revision,
        state: snapshot.state,
        locale: snapshot.locale,
      }).catch(() => {
        // Main keeps the window open if it cannot validate this response.
      })
    })
  }, [bridge])
}
