// 工作台性格: the reading companion's system text, chosen globally like tavern's card workbench.
// Built-in texts ship in prompts/personas/; the user's choice, edits and own personas live in
// data/settings.json.
import { readFileSync } from 'node:fs'

const DIRECTORY = new URL('./prompts/personas/', import.meta.url)

/** Built-ins, same three as dsh-tavern's 卡片工作台性格. */
export const BUILTIN_PERSONAS = Object.freeze([
  ['zhumi', '猫娘助手 · 煮米'],
  ['editor', '冷静专业编辑'],
  ['roaster', '毒舌吐槽役 · 阿刺'],
].map(([id, name]) => Object.freeze({ id, name, text: readFileSync(new URL(`${id}.md`, DIRECTORY), 'utf8').trim() })))

/** Text a new persona starts with, for the user to fill in. */
const NEW_PERSONA_TEXT = `# 你的身份

你是……（写下这位陪读者是谁、懂什么）

# 你的风格

- 怎么说话：
- 重点关注：
- 不要做的事：`

/**
 * Settings shape: `{ activeId: '' | id, edits: { [id]: text }, custom: [{ id, name, text }],
 * groups: { [书库 group]: '' | id } }`; blank means no persona. activeId is the default; a group
 * listed in `groups` uses its own persona instead. Built-ins can be edited and restored; custom
 * ones are the user's own and can be renamed and deleted.
 */
export function personaView(settings) {
  const edits = settings.edits ?? {}
  return {
    activeId: settings.activeId ?? '',
    groups: settings.groups ?? {},
    items: [
      ...BUILTIN_PERSONAS.map((item) => ({
        id: item.id,
        name: item.name,
        text: edits[item.id] ?? item.text,
        builtin: true,
        modified: edits[item.id] !== undefined && edits[item.id] !== item.text,
      })),
      ...(settings.custom ?? []).map((item) => ({ id: item.id, name: item.name, text: item.text, builtin: false, modified: false })),
    ],
  }
}

/**
 * The persona a book in `group` reads with: the group's own if it has one that still exists,
 * else the default. `{ item, group }`: item null for blank, group set when the group decided.
 */
export function personaFor(settings, group) {
  const view = personaView(settings)
  const find = (id) => view.items.find((item) => item.id === id) ?? null
  const own = group ? view.groups[group] : undefined
  if (own !== undefined && (own === '' || find(own))) return { item: find(own), group }
  return { item: find(view.activeId), group: null }
}

function personaName(name) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('性格名不能为空')
  if (clean.length > 20) throw new Error('性格名最多 20 个字')
  return clean
}

/**
 * Apply one `select | save | restore | create | rename | delete | bind` action and return the next
 * settings. `create` also selects the new persona; `bind` gives `group` persona `id` ('' blank),
 * or back to the default when `id` is null.
 */
export function managePersona(settings, { action, id, text, name, group }) {
  const custom = settings.custom ?? []
  const builtin = BUILTIN_PERSONAS.some((item) => item.id === id)
  const own = custom.some((item) => item.id === id)
  if (action === 'create') {
    const item = { id: `c${Date.now().toString(36)}`, name: personaName(name), text: String(text ?? NEW_PERSONA_TEXT) }
    return { ...settings, custom: [...custom, item], activeId: item.id }
  }
  if (action === 'bind') {
    const groups = { ...settings.groups }
    if (id === null || id === undefined) delete groups[group]
    else if (id === '' || builtin || own) groups[group] = id
    else throw new Error(`unknown persona: ${id}`)
    return { ...settings, groups }
  }
  if (action === 'select') {
    if (id !== '' && !builtin && !own) throw new Error(`unknown persona: ${id}`)
    return { ...settings, activeId: id }
  }
  if (!builtin && !own) throw new Error(`unknown persona: ${id}`)
  if (action === 'save' && own) return { ...settings, custom: custom.map((item) => item.id === id ? { ...item, text: String(text ?? '') } : item) }
  if (action === 'rename' && own) return { ...settings, custom: custom.map((item) => item.id === id ? { ...item, name: personaName(name) } : item) }
  if (action === 'delete' && own) {
    // Groups that read with it go back to the default.
    const groups = Object.fromEntries(Object.entries(settings.groups ?? {}).filter(([, value]) => value !== id))
    return { ...settings, custom: custom.filter((item) => item.id !== id), groups, activeId: settings.activeId === id ? '' : settings.activeId }
  }
  if (!builtin) throw new Error(`内置性格才能「${action}」`)
  const edits = { ...settings.edits }
  if (action === 'save') edits[id] = String(text ?? '')
  else if (action === 'restore') delete edits[id]
  else throw new Error(`unknown action: ${action}`)
  return { ...settings, edits }
}

/** Follow a 书库 group's rename (to a name) or deletion (to null). */
export function moveGroupPersona(settings, from, to) {
  const groups = { ...settings.groups }
  if (!(from in groups)) return settings
  if (to) groups[to] = groups[from]
  delete groups[from]
  return { ...settings, groups }
}
