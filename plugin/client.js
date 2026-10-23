/**
 * dsh-reader — browser half.
 *
 * Swaps the two columns of a reading session: the reader shadows the centre
 * `main.conversation` seat, and the native Conversation moves into a right
 * Sidebar tab (the same embedded occurrence ui-subagent uses for child chats).
 * A session without a book keeps the ordinary centre Conversation, so one
 * session never shows two composers.
 *
 * Like dsh-tavern, the left sidebar's workspace browser is replaced with the
 * reader's own: start reading (pick a book → a new session bound to it),
 * import a book, and reading history grouped by book. 书库 and 工作台性格 are
 * right Sidebar pages.
 */
window.__ModuleLoader__.load({
  id: 'dsh-reader',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const { useState, useEffect, useRef, useSyncExternalStore } = React

    const ROUTE = '/api/dsh-reader'
    const CHAT_KIND = 'dsh-reader-chat'
    const CHAT_SLOT = 'dsh-reader.chat.conversation'
    const LIBRARY_KIND = 'dsh-reader-library'
    const PERSONA_KIND = 'dsh-reader-persona'
    /** Lower wins: shadows the shipped occupant without disposing it. */
    const SHADOW_PRIORITY = -10
    const NARROW = window.matchMedia('(max-width: 767px)')

    const CSS = `
.dr-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,inherit);color:var(--dsw-alias-label-primary)}
.dr-bar{display:flex;align-items:center;gap:8px;overflow-x:auto;padding:10px 16px;padding-left:max(16px,var(--dsh-frame-leading-clearance,0px));border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:13px;flex:none}
.dr-bar .dr-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-bar .dr-grow{flex:1}
.dr-btn{white-space:nowrap;flex:none;border:none;background:var(--dsw-alias-bg-module-platform);color:inherit;border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}
.dr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-btn:disabled{opacity:.4;cursor:default}
.dr-btn-line{background:transparent;border:.5px solid var(--dsw-alias-border-l2)}
.dr-btn-wide{width:100%;padding:9px 10px;font-weight:600}
.dr-select{max-width:40%;font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:8px;padding:5px 8px}
.dr-page{flex:1;overflow:auto;min-height:0}
.dr-text{max-width:720px;margin:0 auto;padding:32px 24px 96px;font-size:17px;line-height:1.9;white-space:pre-wrap;word-break:break-word}
.dr-text h2{font-size:22px;margin:0 0 24px;white-space:normal}
.dr-text mark{color:inherit;background:rgba(255,196,0,.28);border-radius:3px;padding:1px 0;box-shadow:0 0 0 2px rgba(255,196,0,.28);animation:dr-flash 1.6s ease-out 2}
@keyframes dr-flash{0%{background:rgba(255,196,0,.6)}100%{background:rgba(255,196,0,.28)}}
.dr-lib{height:100%;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary)}
.dr-lib-head{display:flex;align-items:flex-start;gap:8px}
.dr-lib-head>div{flex:1}
.dr-lib-head h3{margin:0 0 4px;font-size:15px}
.dr-lib-head p,.dr-note{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-card{display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}
.dr-card-on{outline:1px solid var(--dsw-alias-border-l2)}
.dr-card-text{flex:1;min-width:0}
.dr-card-title{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-card-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.dr-strip{display:flex;align-items:center;gap:8px;padding:6px 16px;padding-left:max(16px,var(--dsh-frame-leading-clearance,0px));font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none}
.dr-chat{display:flex;flex-direction:column;height:100%;min-height:0}
.dr-side{height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:12px;min-height:0;overflow:auto;color:var(--dsw-alias-label-primary);font-size:13px;background:var(--dsw-specific-sidebar-fill)}
.dr-side-head{height:56px;display:flex;align-items:center;gap:10px;flex:none;margin-right:40px;padding-left:4px}
.dr-side-mark{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l2)}
.dr-side-name{display:flex;flex-direction:column;line-height:1.15;min-width:0}
.dr-side-name b{font-size:17px;font-weight:750;letter-spacing:.2px;white-space:nowrap}
.dr-side-name span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dr-side-new{height:40px;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-button-elevated-fill);color:inherit;cursor:pointer;font:inherit;font-weight:650}
.dr-side-new:hover{background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-interactive-bg-hover))}
.dr-side-tools{display:grid;grid-template-columns:1fr 1fr;gap:4px;flex:none}
.dr-side-tool{height:32px;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer}
.dr-side-tool:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dr-side-tool:disabled{opacity:.5;cursor:wait}
.dr-side-rail{height:100%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 0}
.dr-side-icon{width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:inherit;cursor:pointer;display:grid;place-items:center}
.dr-side-icon:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-side-label{display:flex;justify-content:space-between;align-items:center;margin:10px 4px 2px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-group-title{display:flex;align-items:center;gap:7px;width:100%;padding:9px 12px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dr-group-title:hover{background:rgba(128,128,128,.12)}
.dr-group-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dr-group-count{flex-shrink:0;opacity:.6;font-size:12px}
.dr-group-items{padding-left:10px;display:flex;flex-direction:column;gap:4px}
.dr-entry{display:block;width:100%;text-align:left;border:none;background:transparent;color:inherit;font:inherit;padding:7px 12px;border-radius:8px;cursor:pointer}
.dr-entry:hover{background:rgba(128,128,128,.12)}
.dr-entry-on{background:var(--dsw-alias-interactive-bg-hover)}
.dr-entry-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-entry small{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dr-persona-row{display:flex;align-items:center;gap:6px;margin-top:auto;padding:10px 6px 0;border-top:.5px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}
.dr-persona-row b{margin-left:auto;color:var(--dsw-alias-label-primary);font-weight:500}
/* Host chrome while the reader owns the sidebar, as dsh-tavern does: the reader's own button replaces
   新建会话, the global panel row (插件/自动化任务) goes, and the host brand gives way to the reader's,
   with the collapse button floating on the right of the same row. */
body.dsh-reader-shell-active button[aria-label="新建会话"],body.dsh-reader-shell-active button[aria-label="New session"],
body.dsh-reader-shell-active nav[aria-label="全局面板"],body.dsh-reader-shell-active nav[aria-label="Global panels"],
body.dsh-reader-shell-active [class*="_logoRow"]>[class*="_brand"]{display:none!important}
body.dsh-reader-shell-active [class*="_root"]:not([class*="_collapsed"]):has(>[class*="_regionArea"]>[data-slot="sidebar.workspaces"]>.dr-side){position:relative}
body.dsh-reader-shell-active [class*="_root"]:not([class*="_collapsed"]):has(>[class*="_regionArea"]>[data-slot="sidebar.workspaces"]>.dr-side)>[class*="_logoRow"]{position:absolute;z-index:2;top:12px;right:12px;height:56px;margin:0;padding:0}
.dr-overlay{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.dr-dialog{width:min(640px,100%);max-height:min(720px,90vh);display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:14px;background:var(--dsw-alias-bg-base,#1e1e1e);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2)}
.dr-dialog-head{display:flex;align-items:center;gap:8px}
.dr-dialog-head h3{margin:0;font-size:16px;flex:1}
.dr-dialog-list{overflow:auto;display:flex;flex-direction:column;gap:8px}
.dr-error{color:#e5484d;font-size:12px;margin:0}
.dr-persona{height:100%;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary)}
.dr-persona textarea{flex:1;min-height:240px;resize:vertical;font:inherit;font-size:13px;line-height:1.6;color:inherit;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:10px;padding:12px}
.dr-persona select{font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:8px;padding:7px 8px}
.dr-persona-actions{display:flex;gap:8px;justify-content:flex-end}
@media (max-width:640px){.dr-text{padding:20px 16px 80px;font-size:16px}}
`

    /** Phase rule copied from ui-subagent's embedded Conversation panel. */
    function conversationPhase(session, conversation, summaryBlank) {
      const shell = conversation.activeTargets.size > 0 || !session.blank && !session.awaitingFirstTurn || session.running
        ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
      const settling = shell === 'blank' && session.openState === 'loading' && summaryBlank !== true
      const hero = shell === 'blank' && (session.openState === 'open' || summaryBlank === true)
      return { phase: settling ? 'settling' : hero ? 'hero' : 'active', hero }
    }

    /** The header seat is declared by the shadowed occupant; render it only if it reaches us. */
    function renderOptionalSlot(renderSlot, name) {
      try { return renderSlot(name, {}) } catch (error) {
        console.warn(`dsh-reader: ${name} unavailable`, error)
        return null
      }
    }

    /** DSH 0.2: the current session is the one the main view retains (ui-workspace's own rule). */
    function mainSessionId(snapshot) {
      for (const row of Object.values(snapshot?.byId ?? {})) {
        if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id
      }
      return undefined
    }

    function formatTime(ms) {
      if (!ms) return ''
      const date = new Date(ms)
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** A tiny observable: `version` bumps on every change, components re-render through useStore. */
    function createSignal() {
      let version = 0
      const listeners = new Set()
      return {
        get: () => version,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        bump() { version += 1; for (const listener of listeners) listener() },
      }
    }

    function useSignal(signal) {
      return useSyncExternalStore(signal.subscribe, signal.get)
    }

    /**
     * Which book each session reads, shared by the centre, the sidebars and the 书库 tab.
     * `get` returns `undefined` while unknown and `null` for no book.
     */
    function createBindingStore(rpc, closeChat) {
      const bindings = new Map()
      const changed = createSignal()
      let loadedAll = false
      const set = (sessionId, value) => { bindings.set(sessionId, value); changed.bump() }
      return {
        changed,
        get: (sessionId) => bindings.has(sessionId) ? bindings.get(sessionId) : loadedAll ? null : undefined,
        all: () => [...bindings].filter(([, b]) => b?.bookId),
        load(sessionId) {
          if (bindings.has(sessionId)) return
          bindings.set(sessionId, undefined)
          rpc('binding', { sessionId }).then((b) => set(sessionId, b))
        },
        loadAll() {
          return rpc('bindings').then((all) => {
            for (const [sessionId, b] of Object.entries(all)) bindings.set(sessionId, b)
            loadedAll = true
            changed.bump()
          })
        },
        bind: (sessionId, patch) => rpc('bind', { sessionId, binding: patch }).then((b) => set(sessionId, b)),
        /** A change made elsewhere (the agent's show_passage), delivered by the watch loop. */
        apply: set,
        close(sessionId) {
          // Unmount the side composer before the centre one takes the session's editor back.
          closeChat(sessionId)
          return rpc('bind', { sessionId, binding: null }).then((b) => set(sessionId, b))
        },
      }
    }

    function useBinding(store, sessionId) {
      useSignal(store.changed)
      useEffect(() => { if (sessionId !== undefined) store.load(sessionId) }, [sessionId])
      return sessionId === undefined ? undefined : store.get(sessionId)
    }

    /** Book list, re-read whenever an import lands. */
    function useLibrary(app) {
      const version = useSignal(app.libraryChanged)
      const [state, setState] = useState({ books: null, error: null })
      useEffect(() => {
        let live = true
        app.rpc('library').then((books) => live && setState({ books, error: null }),
          (e) => live && setState({ books: [], error: String(e?.message ?? e) }))
        return () => { live = false }
      }, [version])
      return state
    }

    function useCurrentSessionId(sessions) {
      const snapshot = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
      return mainSessionId(snapshot)
    }

    /** 导入新书: a hidden file input behind a button. */
    function ImportButton({ app, className, label = '导入新书', onImported }) {
      const input = useRef(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      async function pick(event) {
        const files = [...event.target.files]
        event.target.value = ''
        if (!files.length) return
        setBusy(true)
        setError(null)
        try {
          let last
          for (const file of files) last = await app.importFile(file)
          onImported?.(last)
        } catch (e) { setError(String(e?.message ?? e)) } finally { setBusy(false) }
      }
      return h(React.Fragment, null,
        h('input', { ref: input, type: 'file', accept: '.txt,text/plain', multiple: true, hidden: true, onChange: pick }),
        h('button', { type: 'button', className: className ?? 'dr-btn', disabled: busy, onClick: () => input.current?.click() }, busy ? '导入中…' : label),
        error ? h('p', { className: 'dr-error' }, error) : null)
    }

    /** 选择一本书 · 开始阅读: dialog over the whole frame, like tavern's card picker. */
    function BookPicker({ app, onClose }) {
      const { books, error } = useLibrary(app)
      const [starting, setStarting] = useState(null)
      const [failure, setFailure] = useState(null)
      async function start(bookId) {
        setStarting(bookId)
        setFailure(null)
        try { await app.startReading(bookId); onClose() } catch (e) { setFailure(String(e?.message ?? e)); setStarting(null) }
      }
      return createPortal(h('div', { className: 'dr-overlay', onPointerDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { className: 'dr-dialog', role: 'dialog', 'aria-label': '选择一本书' },
          h('div', { className: 'dr-dialog-head' },
            h('h3', null, '选择一本书 · 开始阅读'),
            h(ImportButton, { app, className: 'dr-btn dr-btn-line' }),
            h('button', { type: 'button', className: 'dr-btn', onClick: onClose }, '关闭')),
          h('p', { className: 'dr-note' }, '每本书开一个新对话；Agent 以当前的工作台性格陪你读。'),
          failure ? h('p', { className: 'dr-error' }, failure) : null,
          h('div', { className: 'dr-dialog-list' },
            error ? h('p', { className: 'dr-error' }, error)
              : books === null ? h('p', { className: 'dr-note' }, '读取中…')
                : books.length === 0 ? h('p', { className: 'dr-note' }, '书库是空的，先导入一本 TXT。')
                  : books.map((b) => h('div', { key: b.id, className: 'dr-card' },
                    h('div', { className: 'dr-card-text' },
                      h('div', { className: 'dr-card-title' }, b.title),
                      h('div', { className: 'dr-card-meta' }, `${b.chars.toLocaleString()} 字 · ${b.chapters} 节`)),
                    h('button', { type: 'button', className: 'dr-btn dr-btn-line', disabled: starting !== null, onClick: () => start(b.id) },
                      starting === b.id ? '正在打开…' : '开始阅读')))))), document.body)
    }

    /** Small line icons (16px, currentColor) for the sidebar. */
    const ICONS = {
      book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H12v12H5.5A1.5 1.5 0 0 0 4 16.5zM4 16.5A1.5 1.5 0 0 0 5.5 18H16V6M12 3h4v3',
      import: 'M10 3v9M6.5 8.5 10 12l3.5-3.5M4 14v2.5h12V14',
      shelf: 'M3.5 4v12M7 4v12M10.5 5l3.5 11M3 16.5h14',
      plus: 'M10 4v12M4 10h12',
    }
    function Icon({ name, size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: ICONS[name] }))
    }

    /** Left sidebar: replaces ui-workspace's browser, like tavern's sidebar. */
    function ReaderSidebar({ wide, expandSidebar, app }) {
      const [picking, setPicking] = useState(false)
      const [closed, setClosed] = useState(() => new Set())
      const { books } = useLibrary(app)
      const persona = usePersonas(app)
      useSignal(app.store.changed)
      const snapshot = useSyncExternalStore(app.sessions.list.subscribe, app.sessions.list.getSnapshot)
      const current = mainSessionId(snapshot)
      useEffect(() => { app.store.loadAll() }, [])
      useEffect(() => {
        document.body.classList.add('dsh-reader-shell-active')
        return () => document.body.classList.remove('dsh-reader-shell-active')
      }, [])

      if (!wide) {
        return h('div', { className: 'dr-side-rail' },
          h('button', { type: 'button', className: 'dr-side-icon', title: '选择一本书 · 开始阅读', 'aria-label': '开始阅读', onClick: expandSidebar }, h(Icon, { name: 'plus', size: 18 })))
      }

      const titles = new Map((books ?? []).map((b) => [b.id, b.title]))
      const groups = new Map()
      for (const [sessionId, binding] of app.store.all()) {
        const row = snapshot.byId?.[sessionId]
        if (row === undefined || row.archived) continue
        if (!groups.has(binding.bookId)) groups.set(binding.bookId, [])
        groups.get(binding.bookId).push({ sessionId, row, binding })
      }
      const ordered = [...groups].map(([bookId, items]) => {
        items.sort((a, b) => (b.binding.updatedAt ?? 0) - (a.binding.updatedAt ?? 0))
        return { bookId, items, latest: items[0].binding.updatedAt ?? 0 }
      }).sort((a, b) => b.latest - a.latest)
      const toggle = (bookId) => setClosed((set) => {
        const next = new Set(set)
        next.has(bookId) ? next.delete(bookId) : next.add(bookId)
        return next
      })
      const activePersona = persona?.items.find((item) => item.id === persona.activeId)

      const total = ordered.reduce((n, group) => n + group.items.length, 0)

      return h('div', { className: 'dr-side' },
        h('div', { className: 'dr-side-head' },
          h('span', { className: 'dr-side-mark' }, h(Icon, { name: 'book', size: 17 })),
          h('span', { className: 'dr-side-name' }, h('b', null, 'DSH 阅读器'), h('span', null, '书在中间 · 陪读在右边'))),
        h('button', { type: 'button', className: 'dr-side-new', onClick: () => setPicking(true) }, '＋ 选择一本书 · 开始阅读'),
        h('div', { className: 'dr-side-tools' },
          h(ImportButton, { app, className: 'dr-side-tool', label: [h(Icon, { key: 'i', name: 'import' }), '导入新书'] }),
          h('button', { type: 'button', className: 'dr-side-tool', onClick: () => app.openLibrary(current) }, h(Icon, { name: 'shelf' }), '书库')),
        h('div', { className: 'dr-side-label' }, h('span', null, '阅读历史'), total ? h('span', null, total) : null),
        ordered.length === 0 ? h('p', { className: 'dr-note', style: { padding: '0 6px' } }, '还没有读过的书。点上面的按钮选一本开始。') : ordered.map((group) => h('div', { key: group.bookId },
          h('button', { type: 'button', className: 'dr-group-title', 'aria-expanded': !closed.has(group.bookId), onClick: () => toggle(group.bookId) },
            h('span', { 'aria-hidden': true }, closed.has(group.bookId) ? '▸' : '▾'),
            h('span', { className: 'dr-group-name' }, titles.get(group.bookId) ?? group.bookId),
            h('span', { className: 'dr-group-count' }, group.items.length)),
          closed.has(group.bookId) ? null : h('div', { className: 'dr-group-items' }, group.items.map(({ sessionId, row, binding }) => h('button', {
            key: sessionId, type: 'button',
            className: 'dr-entry' + (sessionId === current ? ' dr-entry-on' : ''),
            onClick: () => app.openSession(sessionId),
          }, h('span', { className: 'dr-entry-title' }, row.title ?? '新的阅读'),
          h('small', null, [`第 ${(binding.chapter ?? 0) + 1} 节`, formatTime(binding.updatedAt)].filter(Boolean).join(' · '))))))),
        h('div', { className: 'dr-persona-row', onClick: () => app.openPersona(current), title: '切换工作台性格' },
          h('span', null, '工作台性格'), h('b', null, activePersona?.name ?? '空白')),
        picking ? h(BookPicker, { app, onClose: () => setPicking(false) }) : null)
    }

    /** Persona library view, refreshed whenever it changes anywhere. */
    function usePersonas(app) {
      const version = useSignal(app.personasChanged)
      const [view, setView] = useState(null)
      useEffect(() => { app.rpc('personas').then(setView) }, [version])
      return view
    }

    /** Right Sidebar 工作台性格 page: pick one of tavern's built-ins (or blank) and edit its text. */
    function PersonaTab({ app }) {
      const view = usePersonas(app)
      const [draft, setDraft] = useState(null)
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      if (view === null) return h('div', { className: 'dr-persona' }, h('p', { className: 'dr-note' }, '读取中…'))
      const active = view.items.find((item) => item.id === view.activeId) ?? null
      const text = draft ?? active?.text ?? ''
      const dirty = active !== null && draft !== null && draft !== active.text
      async function manage(payload, message) {
        if (dirty && payload.action !== 'save' && !window.confirm('当前性格有未保存的修改，继续会丢弃这些修改。是否继续？')) return
        setBusy(true)
        try {
          await app.rpc('persona', payload)
          setDraft(null)
          setNotice(message)
          app.personasChanged.bump()
        } catch (e) { setNotice(String(e?.message ?? e)) } finally { setBusy(false) }
      }
      return h('div', { className: 'dr-persona' },
        h('div', { className: 'dr-lib-head' }, h('div', null,
          h('h3', null, '工作台性格'),
          h('p', null, '陪读 Agent 的性格，对所有阅读对话生效，从下一次请求开始。'))),
        h('select', {
          value: view.activeId, disabled: busy,
          onChange: (e) => manage({ action: 'select', id: e.target.value }, e.target.value ? '已切换性格。' : '已切换为空白。'),
        }, h('option', { value: '' }, '空白（不带性格）'), view.items.map((item) => h('option', { key: item.id, value: item.id }, item.name + (item.modified ? '（已修改）' : '')))),
        active === null ? h('p', { className: 'dr-note' }, '当前为空白：Agent 不带自定义性格。')
          : h(React.Fragment, null,
            h('textarea', { value: text, disabled: busy, 'aria-label': '性格内容', onChange: (e) => { setDraft(e.target.value); setNotice('') } }),
            h('div', { className: 'dr-persona-actions' },
              h('button', { type: 'button', className: 'dr-btn dr-btn-line', disabled: busy || !active.modified, onClick: () => window.confirm(`把「${active.name}」恢复为内置的默认内容？你的修改会丢失。`) && manage({ action: 'restore', id: active.id }, '已恢复默认内容。') }, '恢复默认'),
              h('button', { type: 'button', className: 'dr-btn', disabled: busy || !dirty, onClick: () => manage({ action: 'save', id: active.id, text }, '已保存，从下一次请求开始生效。') }, '保存'))),
        notice ? h('p', { className: 'dr-note' }, notice) : null)
    }

    function FixedChatView(props) {
      return props.renderSlot('conversation.session', { view: 'chat' })
    }

    /** Right Sidebar tab body: the native Conversation, bound to the current session. */
    function ChatTab({ renderSlot }) {
      return h('div', { className: 'dr-chat' }, renderSlot(CHAT_SLOT, {}))
    }

    function ChatConversation({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
      const session = useSession((s) => s)
      const conversation = useConversation((s) => s)
      const summaryBlank = useSessions((s) => s.byId[sessionId]?.blank)
      const { phase, hero } = conversationPhase(session, conversation, summaryBlank)
      return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views: FixedChatView } })
    }

    /** The original centre: header plus the main Conversation occurrence. */
    function CentreConversation(props) {
      const { sessionId, useSession, useConversation, useSessions, renderSlot, renderFactorySlot, onOpenLibrary } = props
      const session = useSession((s) => s)
      const conversation = useConversation((s) => s)
      const summaryBlank = useSessions((s) => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
      const { phase, hero } = sessionId === undefined || session === undefined || conversation === undefined
        ? { phase: 'hero', hero: true }
        : conversationPhase(session, conversation, summaryBlank)
      return h('div', { className: 'dr-root', 'data-phase': phase },
        sessionId === undefined ? null : h('div', { className: 'dr-strip' },
          h('span', null, '这个会话还没有打开书'),
          h('button', { type: 'button', className: 'dr-btn', onClick: onOpenLibrary }, '打开书库')),
        renderOptionalSlot(renderSlot, 'conversation.header'),
        renderFactorySlot('conversation.content', { variant: 'main', phase, hero }))
    }

    /** Right Sidebar 书库 page: one card per book, like tavern's 人物卡库. */
    function LibraryTab({ sessionId, app }) {
      const { books, error } = useLibrary(app)
      const binding = useBinding(app.store, sessionId)
      const [failure, setFailure] = useState(null)
      const current = binding?.bookId
      // Switching keeps each book's place (the host remembers positions per book); 新开 starts a separate session.
      const run = (work) => work.catch((e) => setFailure(String(e?.message ?? e)))
      const here = (bookId) => run(app.store.bind(sessionId, { bookId }))
      const fresh = (bookId) => run(app.startReading(bookId))
      return h('div', { className: 'dr-lib' },
        h('div', { className: 'dr-lib-head' },
          h('div', null,
            h('h3', null, '书库'),
            h('p', null, '导入 TXT，或直接放进 dsh-reader/library/ 目录。一本书一个对话，阅读位置随对话保存。')),
          h(ImportButton, { app, className: 'dr-btn dr-btn-line', label: '导入' })),
        failure ? h('p', { className: 'dr-error' }, failure) : null,
        error ? h('p', { className: 'dr-error' }, error)
          : books === null ? h('p', { className: 'dr-note' }, '读取中…')
            : books.length === 0 ? h('p', { className: 'dr-note' }, '书库是空的。')
              : books.map((b) => h('div', { key: b.id, className: 'dr-card' + (b.id === current ? ' dr-card-on' : '') },
                h('div', { className: 'dr-card-text' },
                  h('div', { className: 'dr-card-title' }, (b.id === current ? '✓ ' : '') + b.title),
                  h('div', { className: 'dr-card-meta' }, `${b.chars.toLocaleString()} 字 · ${b.chapters} 节`
                    + (b.id === current ? ` · 读到第 ${(binding.chapter ?? 0) + 1} 节` : ''))),
                b.id === current
                  ? h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => app.store.close(sessionId) }, '合上')
                  : h('div', { className: 'dr-side-row' },
                    h('button', { type: 'button', className: 'dr-btn dr-btn-line', title: '在这个对话里换成这本书', onClick: () => here(b.id) }, current ? '换到这本' : '打开'),
                    current ? h('button', { type: 'button', className: 'dr-btn dr-btn-line', title: '为这本书新开一个对话', onClick: () => fresh(b.id) }, '新开') : null))))
    }

    /**
     * Split the displayed body around the agent's quote. The host gives the quote's offset in the chapter
     * file; the body drops the heading line, so pick the occurrence nearest that offset.
     */
    function highlight(body, removed, anchor) {
      if (!anchor?.quote) return [body, null]
      let best = -1
      for (let at = body.indexOf(anchor.quote); at >= 0; at = body.indexOf(anchor.quote, at + 1)) {
        if (best < 0 || Math.abs(at + removed - anchor.at) < Math.abs(best + removed - anchor.at)) best = at
      }
      if (best < 0) return [body, null]
      return [body.slice(0, best), h('mark', { key: anchor.nonce, 'data-dr-anchor': '' }, anchor.quote), body.slice(best + anchor.quote.length)]
    }

    function Reader({ rpc, binding, onMove, onClose, onShowChat }) {
      const [toc, setToc] = useState(null)
      const [chapter, setChapter] = useState(null)
      const page = useRef(null)
      const index = binding.chapter ?? 0
      const anchor = binding.anchor ?? null
      useEffect(() => { rpc('toc', { bookId: binding.bookId }).then(setToc) }, [binding.bookId])
      useEffect(() => {
        setChapter(null)
        rpc('chapter', { bookId: binding.bookId, index }).then(setChapter)
      }, [binding.bookId, index])
      // Bring the agent's passage to the middle of the page once its chapter is on screen.
      useEffect(() => {
        if (chapter === null || chapter.index !== index || !anchor) return
        page.current?.querySelector('[data-dr-anchor]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, [chapter, anchor?.nonce])
      const count = toc?.chapters.length ?? 0
      return h('div', { className: 'dr-root' },
        h('div', { className: 'dr-bar' },
          h('span', { className: 'dr-title' }, toc?.title ?? '…'),
          toc ? h('select', { className: 'dr-select', value: index, onChange: (e) => onMove(Number(e.target.value)) },
            toc.chapters.map((t, i) => h('option', { key: i, value: i }, t))) : null,
          h('span', { className: 'dr-grow' }),
          h('button', { type: 'button', className: 'dr-btn', disabled: index <= 0, onClick: () => onMove(index - 1) }, '上一章'),
          h('button', { type: 'button', className: 'dr-btn', disabled: index >= count - 1, onClick: () => onMove(index + 1) }, '下一章'),
          h('button', { type: 'button', className: 'dr-btn', onClick: onShowChat }, '对话'),
          h('button', { type: 'button', className: 'dr-btn', onClick: onClose }, '合上')),
        h('div', { className: 'dr-page', key: index, ref: page },
          h('article', { className: 'dr-text' },
            chapter === null || chapter.index !== index ? '读取中…' : (() => {
              const body = chapter.text.replace(/^[^\n]*\n/, '')
              return [h('h2', { key: 't' }, chapter.title), ...highlight(body, chapter.text.length - body.length, anchor)]
            })())))
    }

    /** Centre occupant: the reader when the session has a book, otherwise the ordinary Conversation. */
    function ReaderCentre(props) {
      const { sessionId, app } = props
      const binding = useBinding(app.store, sessionId)

      // Follow moves made by the agent (show_passage) while this session is open.
      useEffect(() => {
        if (sessionId === undefined) return
        const controller = new AbortController()
        ;(async () => {
          let version
          while (!controller.signal.aborted) {
            try {
              const result = await app.rpc('watch', { sessionId, version }, controller.signal)
              if (result.changed) app.store.apply(sessionId, result.binding)
              version = result.version
            } catch {
              if (controller.signal.aborted) return
              await new Promise((resolve) => setTimeout(resolve, 3000))
            }
          }
        })()
        return () => controller.abort()
      }, [sessionId])

      const reading = sessionId !== undefined && binding?.bookId
      // On a phone the side panel goes fullscreen, so let the reader stay in front until asked.
      useEffect(() => { if (reading && !NARROW.matches) app.openChat() }, [reading, sessionId])

      // A session owns one composer editor; never mount the centre one while the binding is unknown.
      if (sessionId !== undefined && binding === undefined) return h('div', { className: 'dr-root' })
      if (!reading) return h(CentreConversation, { ...props, onOpenLibrary: () => app.openLibrary(sessionId) })
      return h(Reader, {
        rpc: app.rpc, binding,
        onMove: (chapter) => app.store.bind(sessionId, { chapter }),
        onClose: () => app.store.close(sessionId),
        onShowChat: app.openChat,
      })
    }

    return {
      inject: ['slots', 'sessions', 'workspaces', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        const rpc = async (endpoint, payload = {}, signal) => {
          const res = await fetch(`${ROUTE}/${endpoint}`, {
            method: 'POST', credentials: 'same-origin', signal,
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          })
          const body = await res.json()
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
          return body.result
        }
        const uiWorkspace = () => { try { return ctx.get('uiWorkspace') } catch { return undefined } }
        const closeChat = (sessionId) => {
          for (const tab of ctx.sidebarRight.openTabs.getSnapshot()) {
            if (tab.kind === CHAT_KIND && tab.sessionId === sessionId) ctx.sidebarRight.close(tab.tabId)
          }
        }
        // The right column is per session; with no session open there is nowhere to put a page.
        const openPage = (kind, sessionId) => {
          if (sessionId === undefined) return window.alert('先选一本书开始阅读，再打开这个页面。')
          ctx.sidebarRight.openTab(kind)
        }

        /** Wait until the Host list shows a session, so ui-workspace can open it. */
        async function waitForSession(sessionId) {
          for (let i = 0; i < 20; i += 1) {
            if (ctx.sessions.list.getSnapshot().byId?.[sessionId]) return
            await ctx.sessions.refresh().catch(() => {})
            await new Promise((resolve) => setTimeout(resolve, 150))
          }
          throw new Error('新对话没有出现在会话列表里，请重试')
        }

        const app = {
          rpc,
          sessions: ctx.sessions,
          store: createBindingStore(rpc, closeChat),
          libraryChanged: createSignal(),
          personasChanged: createSignal(),
          openChat: () => ctx.sidebarRight.openTab(CHAT_KIND),
          openLibrary: (sessionId) => openPage(LIBRARY_KIND, sessionId),
          openPersona: (sessionId) => openPage(PERSONA_KIND, sessionId),
          openSession: (sessionId) => uiWorkspace()?.openSession(sessionId),
          /** Tavern's 新开游玩, for books: a fresh session in the library workspace, bound before it opens. */
          async startReading(bookId) {
            const { library } = await rpc('info')
            const workspace = await ctx.workspaces.create({ path: library })
            const sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
            await app.store.bind(sessionId, { bookId, chapter: 0 })
            await waitForSession(sessionId)
            app.openSession(sessionId)
            return sessionId
          },
          async importFile(file) {
            const res = await fetch(`${ROUTE}/import?name=${encodeURIComponent(file.name)}`, {
              method: 'POST', credentials: 'same-origin',
              headers: { 'content-type': 'application/octet-stream' }, body: file,
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
            app.libraryChanged.bump()
            return body.result
          },
        }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-reader'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-reader: styles')

        ctx.effect(() => ctx.slots.inject('main.conversation', () => ctx.slots.register({
          name: 'main.conversation',
          priority: SHADOW_PRIORITY,
          inject: () => ({ app }),
        }, ReaderCentre)), 'dsh-reader: centre reader')

        ctx.effect(() => ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
          name: 'sidebar.workspaces',
          priority: SHADOW_PRIORITY,
          inject: () => ({ app }),
        }, ReaderSidebar)), 'dsh-reader: left sidebar')

        const pages = [
          { id: 'dsh-reader', kind: CHAT_KIND, title: '对话', body: ChatTab, children: { [CHAT_SLOT]: { kind: 'single', scope: 'session' } } },
          { id: 'dsh-reader-library', kind: LIBRARY_KIND, title: '书库', body: LibraryTab, guide: '导入新书，选一本开始阅读' },
          { id: 'dsh-reader-persona', kind: PERSONA_KIND, title: '工作台性格', body: PersonaTab, guide: '陪读 Agent 的性格' },
        ]
        pages.forEach((page, order) => {
          ctx.effect(() => ctx.sidebarRightTabs.register({
            id: page.id,
            kind: page.kind,
            title: () => page.title,
            guide: page.guide ? [{ id: page.kind, order: 10 + order, title: () => page.title, description: () => page.guide }] : undefined,
          }), `dsh-reader: ${page.title} tab type`)
          ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: page.id,
            children: page.children,
            inject: () => ({ app }),
          }, page.body)), `dsh-reader: ${page.title} tab body`)
        })

        ctx.effect(() => ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT }, ChatConversation)),
          'dsh-reader: chat conversation')
      },
    }
  },
})
