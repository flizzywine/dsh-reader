// 工作台性格: the reading companion's system text, chosen globally like tavern's card workbench.
// Built-in texts ship in prompts/personas/; the user's choice and edits live in data/settings.json.
import { readFileSync } from 'node:fs'

const DIRECTORY = new URL('./prompts/personas/', import.meta.url)

/** Built-ins, same three as dsh-tavern's 卡片工作台性格. */
export const BUILTIN_PERSONAS = Object.freeze([
  ['zhumi', '猫娘助手 · 煮米'],
  ['editor', '冷静专业编辑'],
  ['roaster', '毒舌吐槽役 · 阿刺'],
].map(([id, name]) => Object.freeze({ id, name, text: readFileSync(new URL(`${id}.md`, DIRECTORY), 'utf8').trim() })))

/** Settings shape: `{ activeId: '' | id, edits: { [id]: text } }`; blank activeId means no persona. */
export function personaView(settings) {
  const edits = settings.edits ?? {}
  return {
    activeId: settings.activeId ?? '',
    items: BUILTIN_PERSONAS.map((item) => ({
      id: item.id,
      name: item.name,
      text: edits[item.id] ?? item.text,
      modified: edits[item.id] !== undefined && edits[item.id] !== item.text,
    })),
  }
}

export function activePersonaText(settings) {
  const view = personaView(settings)
  return view.items.find((item) => item.id === view.activeId)?.text ?? ''
}

/** Apply one `select | save | restore` action and return the next settings. */
export function managePersona(settings, { action, id, text }) {
  const known = BUILTIN_PERSONAS.some((item) => item.id === id)
  if (action === 'select') {
    if (id !== '' && !known) throw new Error(`unknown persona: ${id}`)
    return { ...settings, activeId: id }
  }
  if (!known) throw new Error(`unknown persona: ${id}`)
  const edits = { ...settings.edits }
  if (action === 'save') edits[id] = String(text ?? '')
  else if (action === 'restore') delete edits[id]
  else throw new Error(`unknown action: ${action}`)
  return { ...settings, edits }
}
