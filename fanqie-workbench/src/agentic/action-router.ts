import { loadContextPhase } from './phases/load-context.js'
import { checkMaterialsPhase } from './phases/check-materials.js'
import { writeChapterPhase } from './phases/write-chapter.js'
import { updateTrackingPhase } from './phases/update-tracking.js'
import { writeOutlinePhase } from './phases/write-outline.js'
import { polishChapterPhase } from './phases/polish-chapter.js'
import { reviseChapterPhase } from './phases/revise-chapter.js'
import { deslopChapterPhase } from './phases/deslop-chapter.js'
import { reviewChapterPhase } from './phases/review-chapter.js'
import { clarifyDirectionPhase } from './phases/clarify-direction.js'
import { scaffoldBookPhase } from './phases/scaffold-book.js'
import { volumeReconcilePhase } from './phases/volume-reconcile.js'
import type { Phase } from './phases/phase.js'

const ACTION_PHASES: Record<string, Phase[]> = {
  'chapter.continue': [loadContextPhase, checkMaterialsPhase, writeChapterPhase, updateTrackingPhase, volumeReconcilePhase],
  'chapter.outline': [loadContextPhase, writeOutlinePhase],
  'chapter.revise': [loadContextPhase, reviseChapterPhase],
  'chapter.deslop': [loadContextPhase, deslopChapterPhase],
  'chapter.review': [loadContextPhase, reviewChapterPhase],
  'chapter.next': [loadContextPhase, writeOutlinePhase, writeChapterPhase, polishChapterPhase, updateTrackingPhase, volumeReconcilePhase],
  'book.create': [clarifyDirectionPhase, scaffoldBookPhase],
}

export function routeAction(actionKey: string): Phase[] {
  const phases = ACTION_PHASES[actionKey]
  if (!phases) throw new Error(`unknown action: ${actionKey}`)
  return phases
}

export function listActions(): string[] {
  return Object.keys(ACTION_PHASES)
}
