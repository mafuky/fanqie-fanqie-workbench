export type ActionKey =
  | 'chapter.continue'
  | 'chapter.polish'
  | 'chapter.deslop'
  | 'chapter.review'
  | 'chapter.rewrite'
  | 'editor.selection.polish'
  | 'editor.selection.rewrite'
  | 'market.scan'
  | 'market.bindToBook'
  | 'publish.chapters'

export type ActionScope = 'book' | 'chapter' | 'selection' | 'market' | 'publish'

export type CapabilityBinding = {
  actionKey: ActionKey
  scope: ActionScope
  capability: 'oh-story-claudecode' | 'fanqie-workbench'
  command: string
  legacyCurrentSkill?: string
}

const bindings: Record<ActionKey, CapabilityBinding> = {
  'chapter.continue': { actionKey: 'chapter.continue', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-long-write', legacyCurrentSkill: 'chapter-pipeline' },
  'chapter.polish': { actionKey: 'chapter.polish', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-long-write', legacyCurrentSkill: 'chapter-polish' },
  'chapter.deslop': { actionKey: 'chapter.deslop', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-deslop', legacyCurrentSkill: 'chapter-deslop' },
  'chapter.review': { actionKey: 'chapter.review', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-review', legacyCurrentSkill: 'chapter-review' },
  'chapter.rewrite': { actionKey: 'chapter.rewrite', scope: 'chapter', capability: 'oh-story-claudecode', command: '/story-long-write', legacyCurrentSkill: 'chapter-rewrite' },
  'editor.selection.polish': { actionKey: 'editor.selection.polish', scope: 'selection', capability: 'oh-story-claudecode', command: '/story-long-write' },
  'editor.selection.rewrite': { actionKey: 'editor.selection.rewrite', scope: 'selection', capability: 'oh-story-claudecode', command: '/story-long-write' },
  'market.scan': { actionKey: 'market.scan', scope: 'market', capability: 'oh-story-claudecode', command: 'market-scan-runner' },
  'market.bindToBook': { actionKey: 'market.bindToBook', scope: 'market', capability: 'fanqie-workbench', command: 'bind-market-scan-to-book' },
  'publish.chapters': { actionKey: 'publish.chapters', scope: 'publish', capability: 'fanqie-workbench', command: 'publish-runner' },
}

const legacyActionKeys: Record<string, ActionKey> = Object.fromEntries(
  Object.values(bindings)
    .filter((binding) => binding.legacyCurrentSkill)
    .map((binding) => [binding.legacyCurrentSkill as string, binding.actionKey]),
) as Record<string, ActionKey>

export function normalizeActionKey(value: string): ActionKey {
  if (value in bindings) return value as ActionKey
  const legacy = legacyActionKeys[value]
  if (legacy) return legacy
  throw new Error(`Unknown action: ${value}`)
}

export function getActionBinding(actionKey: ActionKey): CapabilityBinding {
  const binding = bindings[actionKey]
  if (!binding) throw new Error(`Unknown action: ${actionKey}`)
  return binding
}
