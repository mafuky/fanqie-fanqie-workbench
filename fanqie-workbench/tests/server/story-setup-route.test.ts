import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app.js'

async function createTempProject() {
  const projectRoot = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-story-setup-'))
  await mkdir(resolve(projectRoot, '.claude'), { recursive: true })
  await writeFile(resolve(projectRoot, '.claude', 'settings.local.json'), JSON.stringify({
    env: { EXISTING: '1' },
    hooks: {
      Stop: [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: 'echo existing-stop' },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            { type: 'command', command: 'echo existing-session-start' },
          ],
        },
      ],
    },
  }, null, 2), 'utf8')
  return projectRoot
}

const templatesRoot = resolve(process.cwd(), '..', 'oh-story-claudecode', 'skills', 'story-setup', 'references', 'templates')

describe('story setup route', () => {
  afterEach(() => {
    delete process.env.STORY_SETUP_PROJECT_ROOT
    delete process.env.STORY_SETUP_TEMPLATES_ROOT
  })

  it('deploys oh-story infrastructure and merges hooks without replacing existing settings', async () => {
    const projectRoot = await createTempProject()
    process.env.STORY_SETUP_PROJECT_ROOT = projectRoot
    process.env.STORY_SETUP_TEMPLATES_ROOT = templatesRoot
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/story/setup',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.deployedFiles).toEqual(expect.arrayContaining([
      '.claude/hooks/session-start.sh',
      '.claude/hooks/detect-story-gaps.sh',
      '.claude/agents/story-architect.md',
      '.claude/rules/story-outline.md',
      '.story-deployed',
    ]))

    await expect(stat(resolve(projectRoot, '.claude', 'hooks', 'session-start.sh'))).resolves.toMatchObject({})
    await expect(stat(resolve(projectRoot, '.claude', 'agents', 'story-explorer.md'))).resolves.toMatchObject({})
    await expect(stat(resolve(projectRoot, '.claude', 'rules', 'story-format.md'))).resolves.toMatchObject({})
    await expect(readFile(resolve(projectRoot, '.story-deployed'), 'utf8')).resolves.toContain('agents_version: 3')

    const settings = JSON.parse(await readFile(resolve(projectRoot, '.claude', 'settings.local.json'), 'utf8'))
    expect(settings.env).toEqual({ EXISTING: '1' })
    expect(settings.hooks.Stop[0].hooks).toEqual([
      { type: 'command', command: 'echo existing-stop' },
    ])
    expect(settings.hooks.SessionStart[0].hooks.map((hook: { command: string }) => hook.command)).toEqual(expect.arrayContaining([
      'echo existing-session-start',
      'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/session-start.sh',
      'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/detect-story-gaps.sh',
    ]))
    expect(settings.hooks.PreToolUse[0]).toMatchObject({ matcher: 'Bash' })
    expect(settings.hooks.PreToolUse[0].hooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/validate-story-commit.sh' }),
    ]))

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/story/setup',
    })
    expect(secondResponse.statusCode).toBe(200)
    const secondSettings = JSON.parse(await readFile(resolve(projectRoot, '.claude', 'settings.local.json'), 'utf8'))
    const sessionStartCommands = secondSettings.hooks.SessionStart.flatMap((entry: { hooks: Array<{ command: string }> }) => entry.hooks.map((hook) => hook.command))
    expect(sessionStartCommands.filter((command: string) => command === 'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/session-start.sh')).toHaveLength(1)

    await app.close()
  })
})
