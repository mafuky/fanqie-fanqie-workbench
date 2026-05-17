import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

type HookCommand = {
  type: string
  command: string
  timeout?: number
  if?: string
}

type HookEntry = {
  matcher?: string
  hooks: HookCommand[]
}

type Settings = {
  hooks?: Record<string, HookEntry[]>
  [key: string]: unknown
}

async function copyTemplateFiles(input: { templatesRoot: string; projectRoot: string; group: 'hooks' | 'agents' | 'rules'; executable?: boolean }) {
  const sourceDir = resolve(input.templatesRoot, input.group)
  const targetDir = resolve(input.projectRoot, '.claude', input.group)
  await mkdir(targetDir, { recursive: true })

  const files = (await readdir(sourceDir)).filter((file) => input.group === 'hooks' ? file.endsWith('.sh') : file.endsWith('.md'))
  const deployedFiles: string[] = []

  for (const file of files) {
    const targetPath = resolve(targetDir, file)
    await copyFile(resolve(sourceDir, file), targetPath)
    if (input.executable) await chmod(targetPath, 0o755)
    deployedFiles.push(relative(input.projectRoot, targetPath))
  }

  return deployedFiles
}

function mergeHookEntries(existingEntries: HookEntry[] = [], templateEntries: HookEntry[] = []) {
  const merged = existingEntries.map((entry) => ({
    ...entry,
    hooks: [...(entry.hooks || [])],
  }))

  for (const templateEntry of templateEntries) {
    const matchingEntry = merged.find((entry) => (entry.matcher ?? '') === (templateEntry.matcher ?? ''))
    if (!matchingEntry) {
      merged.push({
        ...templateEntry,
        hooks: [...templateEntry.hooks],
      })
      continue
    }

    const existingCommands = new Set((matchingEntry.hooks || []).map((hook) => hook.command))
    for (const hook of templateEntry.hooks || []) {
      if (!existingCommands.has(hook.command)) {
        matchingEntry.hooks.push(hook)
        existingCommands.add(hook.command)
      }
    }
  }

  return merged
}

function mergeSettingsHooks(existingSettings: Settings, templateSettings: Settings) {
  const merged: Settings = {
    ...existingSettings,
    hooks: {
      ...(existingSettings.hooks || {}),
    },
  }

  for (const [eventName, templateEntries] of Object.entries(templateSettings.hooks || {})) {
    merged.hooks![eventName] = mergeHookEntries(merged.hooks![eventName], templateEntries)
  }

  return merged
}

async function readJsonFile(path: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Settings
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function deployStorySetup(input: { projectRoot: string; templatesRoot: string }) {
  const projectRoot = resolve(input.projectRoot)
  const templatesRoot = resolve(input.templatesRoot)
  const deployedFiles = [
    ...await copyTemplateFiles({ templatesRoot, projectRoot, group: 'hooks', executable: true }),
    ...await copyTemplateFiles({ templatesRoot, projectRoot, group: 'agents' }),
    ...await copyTemplateFiles({ templatesRoot, projectRoot, group: 'rules' }),
  ]

  const settingsPath = resolve(projectRoot, '.claude', 'settings.local.json')
  await mkdir(resolve(projectRoot, '.claude'), { recursive: true })
  const existingSettings = await readJsonFile(settingsPath)
  const templateSettings = await readJsonFile(resolve(templatesRoot, 'settings-hooks.json'))
  const mergedSettings = mergeSettingsHooks(existingSettings, templateSettings)
  await writeFile(settingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, 'utf8')
  deployedFiles.push(relative(projectRoot, settingsPath))

  const markerPath = resolve(projectRoot, '.story-deployed')
  await writeFile(markerPath, `deployed_at: ${new Date().toISOString()}\nagents_version: 3\nsetup_skill_version: 1.0.0\n`, 'utf8')
  deployedFiles.push(relative(projectRoot, markerPath))

  return {
    projectRoot,
    templatesRoot,
    deployedFiles: deployedFiles.map((file) => file.split('/').map((part) => basename(part) === part ? part : basename(part)).join('/')),
  }
}
