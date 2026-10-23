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
.dr-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,inherit);color:var(--dsw-alias-label-primary)}
.dr-bar{display:flex;align-items:center;gap:8px;overflow-x:auto;padding:10px 16px;padding-left:max(16px,var(--dsh-frame-leading-clearance,0px));border-bottom:.5px solid var(--dr-line,var(--dsw-alias-border-l2));font-size:13px;flex:none;background:var(--dr-bg,transparent);color:var(--dr-fg,inherit)}
.dr-bar .dr-btn,.dr-bar .dr-toc-open{background:var(--dr-chip,var(--dsw-alias-bg-module-platform))}
.dr-bar .dr-btn:hover,.dr-bar .dr-toc-open:hover,.dr-bar .dr-nav:hover:not(:disabled){background:var(--dr-hover,var(--dsw-alias-interactive-bg-hover))}
.dr-bar .dr-toc-open em{color:var(--dr-muted,var(--dsw-alias-label-tertiary))}
.dr-aa{position:absolute;z-index:7;top:50px;right:12px;width:min(300px,calc(100% - 24px));padding:14px;border-radius:14px;background:var(--dsw-alias-bg-base,#1e1e1e);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 12px 32px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:12px;font-size:13px;animation:dr-fade .12s ease-out}
.dr-aa-row{display:flex;align-items:center;gap:10px}
.dr-aa-row>span:first-child{width:36px;flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dr-aa-swatches{display:flex;gap:8px;flex-wrap:wrap}
.dr-aa-swatch{width:34px;height:34px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;display:grid;place-items:center;font-size:11px;padding:0}
.dr-aa-swatch[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-bg-base),0 0 0 3.5px var(--dsw-alias-label-primary)}
.dr-seg{display:flex;flex:1;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-module-platform)}
.dr-seg button{flex:1;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dr-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.dr-step{display:flex;align-items:center;flex:1;gap:6px}
.dr-step button{width:32px;height:28px;border:0;border-radius:7px;background:var(--dsw-alias-bg-module-platform);color:inherit;font:inherit;font-size:15px;cursor:pointer}
.dr-step button:disabled{opacity:.35;cursor:default}
.dr-step b{flex:1;text-align:center;font-weight:500;font-variant-numeric:tabular-nums}
.dr-aa-foot{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-aa-foot button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-decoration:underline}
.dr-bar .dr-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-bar .dr-grow{flex:1}
.dr-btn{white-space:nowrap;flex:none;border:none;background:var(--dsw-alias-bg-module-platform);color:inherit;border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}
.dr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-btn:disabled{opacity:.4;cursor:default}
.dr-btn-line{background:transparent;border:.5px solid var(--dsw-alias-border-l2)}
.dr-btn-wide{width:100%;padding:9px 10px;font-weight:600}
.dr-toc-open{display:flex;align-items:center;gap:7px;min-width:0;max-width:60%;height:30px;padding:0 10px;border:0;border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:inherit;font:inherit;cursor:pointer}
.dr-toc-open:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-toc-open span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-toc-open em{font-style:normal;color:var(--dsw-alias-label-tertiary);flex:none}
.dr-nav{width:30px;height:30px;flex:none;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.dr-nav:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dr-nav:disabled{opacity:.3;cursor:default}
.dr-scrim{position:absolute;inset:0;z-index:5;background:rgba(0,0,0,.28);animation:dr-fade .15s ease-out}
.dr-toc{position:absolute;z-index:6;top:0;bottom:0;left:0;width:min(320px,88%);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,var(--dsw-specific-sidebar-fill));border-right:.5px solid var(--dsw-alias-border-l2);box-shadow:8px 0 24px rgba(0,0,0,.18);animation:dr-slide .18s ease-out}
@keyframes dr-slide{from{transform:translateX(-24px);opacity:0}}
@keyframes dr-fade{from{opacity:0}}
.dr-toc-head{display:flex;align-items:center;gap:8px;padding:14px 14px 8px;padding-left:max(14px,var(--dsh-frame-leading-clearance,0px))}
.dr-toc-head b{flex:1;font-size:15px;font-weight:650}
.dr-toc-head span{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-toc-search{margin:0 14px 10px;height:32px;padding:0 10px;border:0;border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:inherit;font:inherit;font-size:13px;outline:none}
.dr-toc-progress{padding:0 14px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-toc-progress div{display:flex;justify-content:space-between;margin-bottom:5px}
.dr-toc-progress i{display:block;height:3px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}
.dr-toc-progress i b{display:block;height:100%;background:var(--dsw-alias-label-primary);opacity:.7}
.dr-toc-list{flex:1;min-height:0;overflow:auto;padding:0 6px 16px;font-size:13.5px}
.dr-toc-vol{padding:12px 10px 4px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:600}
.dr-toc-row{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dr-toc-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-toc-row .dr-toc-n{width:28px;flex:none;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dr-toc-row .dr-toc-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-toc-row .dr-toc-tag{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center}
.dr-toc-read{color:var(--dsw-alias-label-tertiary)}
.dr-toc-now{background:var(--dsw-alias-bg-module-platform);font-weight:650}
.dr-toc-now .dr-toc-n,.dr-toc-now .dr-toc-tag{color:var(--dsw-alias-label-primary)}
.dr-page{flex:1;overflow:auto;min-height:0;background:var(--dr-bg,transparent)}
.dr-text{box-sizing:content-box;max-width:var(--dr-measure,36em);margin:0 auto;padding:40px 28px 120px;font-family:var(--dr-font);font-size:var(--dr-size,18px);line-height:var(--dr-leading,1.9);color:var(--dr-fg,inherit);text-align:justify;text-justify:inter-character;word-break:break-word;hyphens:auto;font-feature-settings:"palt" 0}
.dr-text h2{font-size:1.4em;line-height:1.4;font-weight:600;margin:0 0 1.6em;text-align:left;letter-spacing:.02em}
.dr-text h3{font-size:1.1em;font-weight:600;margin:1.6em 0 .8em;text-align:left}
.dr-text p{margin:0 0 .55em;text-indent:2em}
.dr-text .dr-meta{text-indent:0;font-size:.78em;color:var(--dr-muted,var(--dsw-alias-label-tertiary));margin-bottom:1.2em}
.dr-text .dr-end{text-align:center;text-indent:0;margin-top:3em;font-size:.8em;color:var(--dr-muted,var(--dsw-alias-label-tertiary))}
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
      list: 'M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01',
      left: 'M12.5 4.5 7 10l5.5 5.5',
      right: 'M7.5 4.5 13 10l-5.5 5.5',
      close: 'M5 5l10 10M15 5 5 15',
      note: 'M5 3.5h7l3 3v10H5zM8 9.5h4M8 12.5h4',
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

    const HEADING_LINE = /^(第[0-9零一二三四五六七八九十百千万两〇]+[章回节卷集部篇]|序章|序言|楔子|引子|尾声|后记|番外)/
    const META_LINE = /^(作品)?(作者|更新|更新时间|字数|本章字数|首发)[:：]/

    /**
     * Turn a chapter file into display blocks. Source TXT carries its own indentation (spaces or 　),
     * CRLF and stray blank lines; the reader drops all of that and sets its own indent and spacing.
     * Each block keeps its offset in the file, so an agent quote can be found again.
     */
    function blocks(text, title) {
      const out = []
      let at = 0
      for (const raw of text.split('\n')) {
        const start = at
        at += raw.length + 1
        const lead = raw.length - raw.replace(/^[\s\u3000]+/, '').length
        const line = raw.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')
        if (!line) continue
        if (out.length === 0 && start === 0) continue // the file's own heading line; the title is shown above
        if (line === title || (line.length >= 4 && title.endsWith(line))) continue
        const kind = META_LINE.test(line) || (line.includes('更新') && line.includes('字数')) ? 'meta'
          : HEADING_LINE.test(line) && line.length <= 30 ? 'sub' : 'p'
        out.push({ kind, text: line, at: start + lead })
      }
      return out
    }

    /** Render blocks; the agent's quote is marked inside the block nearest its file offset. */
    function renderBlocks(list, anchor) {
      let target = -1
      if (anchor?.quote) {
        const holding = list.map((block, i) => block.text.includes(anchor.quote) ? i : -1).filter((i) => i >= 0)
        target = holding.sort((a, b) => Math.abs(list[a].at - anchor.at) - Math.abs(list[b].at - anchor.at))[0] ?? -1
      }
      return list.map((block, i) => {
        const tag = block.kind === 'sub' ? 'h3' : 'p'
        const props = { key: i, className: block.kind === 'meta' ? 'dr-meta' : undefined }
        if (i !== target) return h(tag, props, block.text)
        const cut = block.text.indexOf(anchor.quote)
        return h(tag, props, block.text.slice(0, cut),
          h('mark', { key: anchor.nonce, 'data-dr-anchor': '' }, anchor.quote), block.text.slice(cut + anchor.quote.length))
      })
    }


    const CHAPTER_PREFIX = /^第[0-9零一二三四五六七八九十百千万两〇]+[章回节]\s*/
    const VOLUME = /^(第[0-9零一二三四五六七八九十百千万两〇]+[卷部集篇][^·]*?) · (.+)$/

    /**
     * Chapter titles as the drawer shows them. Sources mix 「第7章」 and 「第九章」, so the number comes
     * from the drawer's own column and the 第X章 prefix is dropped; 楔子/番外 and the like stay whole.
     * A 「第一卷 X · 第一章 Y」 title (a volume heading merged at split time) opens a volume group.
     */
    function tocRows(chapters) {
      let volume = null
      // A host older than this page sends bare title strings; read both shapes.
      return chapters.map((entry, index) => {
        const chapter = typeof entry === 'string' ? { title: entry } : entry
        const match = VOLUME.exec(chapter.title)
        if (match) volume = match[1].trim()
        const full = match ? match[2] : chapter.title
        return { ...chapter, index, volume, full, name: full.replace(CHAPTER_PREFIX, '').trim() || full }
      })
    }

    /** 目录: slides over the left of the reader, like an e-reader's contents panel. */
    function TocDrawer({ rpc, bookId, index, onPick, onClose }) {
      const [toc, setToc] = useState(null)
      const [query, setQuery] = useState('')
      const list = useRef(null)
      useEffect(() => { rpc('toc', { bookId }).then(setToc) }, [bookId])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      // Open at the chapter being read.
      useEffect(() => { if (toc) list.current?.querySelector('[data-now]')?.scrollIntoView({ block: 'center' }) }, [toc])
      const rows = toc ? tocRows(toc.chapters) : []
      const q = query.trim()
      const shown = q ? rows.filter((row) => String(row.index + 1) === q || row.title.includes(q)) : rows
      const total = rows.length
      const percent = total ? Math.round(((index + 1) / total) * 100) : 0
      const done = rows.filter((row) => row.summarized).length
      let lastVolume = null
      return h(React.Fragment, null,
        h('div', { className: 'dr-scrim', onClick: onClose }),
        h('nav', { className: 'dr-toc', 'aria-label': '目录' },
          h('div', { className: 'dr-toc-head' },
            h('b', null, '目录'),
            h('span', null, `${total} 节${done ? ` · ${done} 节有总结` : ''}`),
            h('button', { type: 'button', className: 'dr-nav', 'aria-label': '关闭目录', onClick: onClose }, h(Icon, { name: 'close' }))),
          h('input', { className: 'dr-toc-search', placeholder: '搜章名或序号', value: query, autoFocus: !NARROW.matches, onChange: (e) => setQuery(e.target.value) }),
          h('div', { className: 'dr-toc-progress' },
            h('div', null, h('span', null, `读到 ${index + 1} / ${total || '…'}`), h('span', null, `${percent}%`)),
            h('i', null, h('b', { style: { width: `${percent}%` } }))),
          h('div', { className: 'dr-toc-list', ref: list },
            toc === null ? h('p', { className: 'dr-note', style: { padding: '8px 10px' } }, '读取中…')
              : shown.length === 0 ? h('p', { className: 'dr-note', style: { padding: '8px 10px' } }, '没有匹配的章节。')
                : shown.flatMap((row) => {
                  const out = []
                  if (!q && row.volume && row.volume !== lastVolume) out.push(h('div', { key: `v${row.index}`, className: 'dr-toc-vol' }, row.volume))
                  lastVolume = row.volume
                  const now = row.index === index
                  out.push(h('button', {
                    key: row.index, type: 'button', title: row.title, 'data-now': now ? '' : undefined,
                    className: 'dr-toc-row' + (now ? ' dr-toc-now' : row.index < index ? ' dr-toc-read' : ''),
                    onClick: () => { onPick(row.index); onClose() },
                  },
                  h('span', { className: 'dr-toc-n' }, row.index + 1),
                  h('span', { className: 'dr-toc-t' }, row.name),
                  now ? h('span', { className: 'dr-toc-tag' }, '在读')
                    : row.summarized ? h('span', { className: 'dr-toc-tag', title: '已有总结' }, h(Icon, { name: 'note', size: 14 })) : null))
                  return out
                }))))
    }

    /** Reading themes, after the usual e-reader set. `auto` keeps the app's own colours. */
    const THEMES = {
      auto: { name: '跟随界面' },
      paper: { name: '纸白', bg: '#F7F5F0', fg: '#2B2A27', muted: '#8A857A' },
      sepia: { name: '羊皮纸', bg: '#F3E9D2', fg: '#4A3B25', muted: '#8A7350' },
      green: { name: '护眼绿', bg: '#E3EDDB', fg: '#2C3A27', muted: '#5F7A53' },
      night: { name: '夜间', bg: '#1C1B19', fg: '#C9C3B6', muted: '#7D786D' },
    }
    const FONTS = {
      song: { name: '宋体', stack: '"Songti SC","STSong","Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","SimSun",serif' },
      kai: { name: '楷体', stack: '"LXGW WenKai","霞鹜文楷","Kaiti SC","STKaiti","KaiTi",serif' },
      hei: { name: '黑体', stack: 'var(--dsh-font-family-text,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif)' },
    }
    const WIDTHS = { narrow: { name: '窄', em: 30 }, medium: { name: '中', em: 36 }, wide: { name: '宽', em: 44 } }
    const TYPE_DEFAULTS = { theme: 'auto', font: 'song', size: 18, leading: 1.9, width: 'medium' }
    const TYPE_KEY = 'dsh-reader:typography'

    /** Reading preferences live in this browser (like any e-reader); storage may be unavailable, so never rely on it. */
    const typography = (() => {
      let value = { ...TYPE_DEFAULTS }
      try { value = { ...value, ...JSON.parse(localStorage.getItem(TYPE_KEY) ?? '{}') } } catch {}
      const changed = createSignal()
      return {
        changed,
        get: () => value,
        set(patch) {
          value = patch === null ? { ...TYPE_DEFAULTS } : { ...value, ...patch }
          try { localStorage.setItem(TYPE_KEY, JSON.stringify(value)) } catch {}
          changed.bump()
        },
      }
    })()

    function useTypography() {
      useSignal(typography.changed)
      return typography.get()
    }

    /** CSS variables the page, bar and text read; `auto` leaves colours to the app theme. */
    function typographyStyle(t) {
      const theme = THEMES[t.theme] ?? THEMES.auto
      const style = {
        '--dr-font': (FONTS[t.font] ?? FONTS.song).stack,
        '--dr-size': `${t.size}px`,
        '--dr-leading': String(t.leading),
        '--dr-measure': `${(WIDTHS[t.width] ?? WIDTHS.medium).em}em`,
      }
      if (theme.bg) {
        const dark = t.theme === 'night'
        Object.assign(style, {
          '--dr-bg': theme.bg, '--dr-fg': theme.fg, '--dr-muted': theme.muted,
          '--dr-line': dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)',
          '--dr-chip': dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)',
          '--dr-hover': dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.09)',
          colorScheme: dark ? 'dark' : 'light',
        })
      }
      return style
    }

    function Stepper({ value, min, max, step, format, onChange }) {
      const round = (n) => Math.round(n * 100) / 100
      return h('div', { className: 'dr-step' },
        h('button', { type: 'button', 'aria-label': '减小', disabled: value <= min, onClick: () => onChange(round(Math.max(min, value - step))) }, '−'),
        h('b', null, format(value)),
        h('button', { type: 'button', 'aria-label': '增大', disabled: value >= max, onClick: () => onChange(round(Math.min(max, value + step))) }, '+'))
    }

    /** The Aa panel: theme, font, size, line height and width for the reading surface. */
    function TypographyPanel({ onClose }) {
      const t = useTypography()
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      const seg = (options, key) => h('div', { className: 'dr-seg' }, Object.entries(options).map(([id, option]) =>
        h('button', { key: id, type: 'button', 'aria-pressed': t[key] === id, onClick: () => typography.set({ [key]: id }) }, option.name)))
      return h(React.Fragment, null,
        h('div', { style: { position: 'absolute', inset: 0, zIndex: 6 }, onClick: onClose }),
        h('div', { className: 'dr-aa', role: 'dialog', 'aria-label': '阅读设置' },
          h('div', { className: 'dr-aa-row' }, h('span', null, '主题'),
            h('div', { className: 'dr-aa-swatches' }, Object.entries(THEMES).map(([id, theme]) => h('button', {
              key: id, type: 'button', className: 'dr-aa-swatch', title: theme.name, 'aria-label': theme.name, 'aria-pressed': t.theme === id,
              style: theme.bg ? { background: theme.bg, color: theme.fg } : { background: 'var(--dsw-alias-bg-module-platform)' },
              onClick: () => typography.set({ theme: id }),
            }, id === 'auto' ? '自动' : '文')))),
          h('div', { className: 'dr-aa-row' }, h('span', null, '字体'), seg(FONTS, 'font')),
          h('div', { className: 'dr-aa-row' }, h('span', null, '字号'),
            h(Stepper, { value: t.size, min: 14, max: 30, step: 1, format: (v) => `${v}`, onChange: (size) => typography.set({ size }) })),
          h('div', { className: 'dr-aa-row' }, h('span', null, '行距'),
            h(Stepper, { value: t.leading, min: 1.4, max: 2.6, step: 0.1, format: (v) => v.toFixed(1), onChange: (leading) => typography.set({ leading }) })),
          h('div', { className: 'dr-aa-row' }, h('span', null, '页宽'), seg(WIDTHS, 'width')),
          h('div', { className: 'dr-aa-foot' }, h('span', null, '只保存在这台浏览器'),
            h('button', { type: 'button', onClick: () => typography.set(null) }, '恢复默认'))))
    }

    function Reader({ rpc, binding, onMove, onClose, onShowChat }) {
      const t = useTypography()
      const [panel, setPanel] = useState(false)
      const [drawer, setDrawer] = useState(false)
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
      const current = toc ? tocRows(toc.chapters)[index] : null
      return h('div', { className: 'dr-root', 'data-theme': t.theme, style: typographyStyle(t) },
        h('div', { className: 'dr-bar' },
          h('span', { className: 'dr-title' }, toc?.title ?? '…'),
          h('button', { type: 'button', className: 'dr-toc-open', title: '目录', 'aria-label': '打开目录', onClick: () => setDrawer(true) },
            h(Icon, { name: 'list' }),
            h('em', null, `${index + 1} / ${count || '…'}`),
            current ? h('span', null, current.name) : null),
          h('span', { className: 'dr-grow' }),
          h('button', { type: 'button', className: 'dr-nav', title: '上一章', 'aria-label': '上一章', disabled: index <= 0, onClick: () => onMove(index - 1) }, h(Icon, { name: 'left' })),
          h('button', { type: 'button', className: 'dr-nav', title: '下一章', 'aria-label': '下一章', disabled: index >= count - 1, onClick: () => onMove(index + 1) }, h(Icon, { name: 'right' })),
          h('button', { type: 'button', className: 'dr-btn', title: '阅读设置', 'aria-label': '阅读设置', 'aria-expanded': panel, onClick: () => setPanel((open) => !open), style: { fontFamily: FONTS.song.stack, fontWeight: 600 } }, 'Aa'),
          h('button', { type: 'button', className: 'dr-btn', onClick: onShowChat }, '对话'),
          h('button', { type: 'button', className: 'dr-btn', onClick: onClose }, '合上')),
        h('div', { className: 'dr-page', key: index, ref: page },
          h('article', { className: 'dr-text' },
            chapter === null || chapter.index !== index ? h('p', { className: 'dr-meta' }, '读取中…') : [
              h('h2', { key: 't' }, current?.full ?? chapter.title),
              ...renderBlocks(blocks(chapter.text.replace(/\r/g, ''), chapter.title), anchor),
              h('p', { key: 'end', className: 'dr-end' }, index >= count - 1 ? '全书完' : `本节完 · 下一节「${toc ? tocRows(toc.chapters)[index + 1]?.name ?? '' : ''}」`),
            ])),
        drawer ? h(TocDrawer, { rpc, bookId: binding.bookId, index, onPick: onMove, onClose: () => setDrawer(false) }) : null,
        panel ? h(TypographyPanel, { onClose: () => setPanel(false) }) : null)
    }

    /**
     * Keeps a reader error inside the reader. Without it a throw makes the slot runtime hand the centre
     * back to ui-conversation while the 对话 tab stays open: two composers on one session.
     */
    class ReaderBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { console.error('dsh-reader: reader crashed', error) }
      render() {
        if (this.state.error === null) return this.props.children
        return h('div', { className: 'dr-root' }, h('div', { className: 'dr-pick', style: { padding: 32 } },
          h('p', null, '阅读区出错了。'),
          h('p', { className: 'dr-note' }, String(this.state.error?.message ?? this.state.error)),
          h('p', { className: 'dr-note' }, '多半是刚升级、宿主还没重启：运行 dsh-reader restart 后再试。'),
          h('button', { type: 'button', className: 'dr-btn', onClick: () => this.setState({ error: null }) }, '重试')))
      }
    }

    function SafeReaderCentre(props) {
      return h(ReaderBoundary, { key: props.sessionId }, h(ReaderCentre, props))
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
        }, SafeReaderCentre)), 'dsh-reader: centre reader')

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
