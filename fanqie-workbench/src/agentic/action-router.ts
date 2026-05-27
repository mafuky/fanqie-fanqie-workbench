import { loadContextPhase } from './phases/load-context.js'
import { checkMaterialsPhase } from './phases/check-materials.js'
import { writeChapterPhase } from './phases/write-chapter.js'
import { updateTrackingPhase } from './phases/update-tracking.js'
import type { Phase } from './phases/phase.js'

const ACTION_PHASES: Record<string, Phase[]> = {
  'chapter.continue': [loadContextPhase, checkMaterialsPhase, writeChapterPhase, updateTrackingPhase],
}

export function routeAction(actionKey: string): Phase[] {
  const phases = ACTION_PHASES[actionKey]
  if (!phases) throw new Error(`unknown action: ${actionKey}`)
  return phases
}

export function listActions(): string[] {
  return Object.keys(ACTION_PHASES)
}
