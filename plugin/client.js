/**
 * dsh-reader — browser half.
 *
 * Swaps the two columns of a reading session: the reader shadows the centre
 * `main.conversation` seat, and the native Conversation moves into a right
 * Sidebar tab (the same embedded occurrence ui-subagent uses for child chats).
 * A session without a book keeps the ordinary centre Conversation, so one
 * session never shows two composers.
 */
window.__ModuleLoader__.load({
  id: 'dsh-reader',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const ROUTE = '/api/dsh-reader'
    const CHAT_KIND = 'dsh-reader-chat'
    const CHAT_SLOT = 'dsh-reader.chat.conversation'
    const LIBRARY_KIND = 'dsh-reader-library'
    /** Lower wins: shadows ui-conversation's centre occupant without disposing it. */
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
.dr-select{max-width:40%;font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:8px;padding:5px 8px}
.dr-page{flex:1;overflow:auto;min-height:0}
.dr-text{max-width:720px;margin:0 auto;padding:32px 24px 96px;font-size:17px;line-height:1.9;white-space:pre-wrap;word-break:break-word}
.dr-text h2{font-size:22px;margin:0 0 24px;white-space:normal}
.dr-btn-line{background:transparent;border:.5px solid var(--dsw-alias-border-l2)}
.dr-lib{height:100%;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary)}
.dr-lib-head h3{margin:0 0 4px;font-size:15px}
.dr-lib-head p,.dr-lib-note{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-card{display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}
.dr-card-on{outline:1px solid var(--dsw-alias-border-l2)}
.dr-card-text{flex:1;min-width:0}
.dr-card-title{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-card-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.dr-strip{display:flex;align-items:center;gap:8px;padding:6px 16px;padding-left:max(16px,var(--dsh-frame-leading-clearance,0px));font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none}
.dr-chat{display:flex;flex-direction:column;height:100%;min-height:0}
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

    /**
     * Which book each session reads, shared by the centre and the 书库 tab.
     * `undefined` = not loaded yet, `null` = no book.
     */
    function createBindingStore(rpc, closeChat) {
      const bindings = new Map()
      const listeners = new Set()
      const set = (sessionId, value) => {
        bindings.set(sessionId, value)
        for (const listener of listeners) listener(sessionId)
      }
      return {
        get: (sessionId) => bindings.get(sessionId),
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        load(sessionId) {
          if (bindings.has(sessionId)) return
          bindings.set(sessionId, undefined)
          rpc('binding', { sessionId }).then((b) => set(sessionId, b))
        },
        bind: (sessionId, patch) => rpc('bind', { sessionId, binding: patch }).then((b) => set(sessionId, b)),
        close(sessionId) {
          // Unmount the side composer before the centre one takes the session's editor back.
          closeChat(sessionId)
          return rpc('bind', { sessionId, binding: null }).then((b) => set(sessionId, b))
        },
      }
    }

    function useBinding(store, sessionId) {
      const [, render] = useState(0)
      useEffect(() => {
        if (sessionId === undefined) return
        store.load(sessionId)
        return store.subscribe((changed) => { if (changed === sessionId) render((n) => n + 1) })
      }, [sessionId])
      return sessionId === undefined ? undefined : store.get(sessionId)
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

    /** Right Sidebar 书库 tab: one card per book; opening one binds it to this session. */
    function LibraryTab({ sessionId, rpc, store }) {
      const [books, setBooks] = useState(null)
      const [error, setError] = useState(null)
      const binding = useBinding(store, sessionId)
      useEffect(() => { rpc('library').then(setBooks, (e) => setError(String(e?.message ?? e))) }, [])
      const current = binding?.bookId
      return h('div', { className: 'dr-lib' },
        h('div', { className: 'dr-lib-head' },
          h('h3', null, '书库'),
          h('p', null, '把 TXT 放进 dsh-reader/library/ 目录。一个会话读一本书，阅读位置随会话保存。')),
        error ? h('p', { className: 'dr-lib-note' }, error)
          : books === null ? h('p', { className: 'dr-lib-note' }, '读取中…')
            : books.length === 0 ? h('p', { className: 'dr-lib-note' }, '书库是空的。')
              : books.map((b) => h('div', { key: b.id, className: 'dr-card' + (b.id === current ? ' dr-card-on' : '') },
                h('div', { className: 'dr-card-text' },
                  h('div', { className: 'dr-card-title' }, (b.id === current ? '✓ ' : '') + b.title),
                  h('div', { className: 'dr-card-meta' }, `${b.chars.toLocaleString()} 字`
                    + (b.id === current ? ` · 读到第 ${(binding.chapter ?? 0) + 1} 节` : ''))),
                b.id === current
                  ? h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => store.close(sessionId) }, '合上')
                  : h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => store.bind(sessionId, { bookId: b.id, chapter: 0 }) }, '打开'))))
    }

    function Reader({ rpc, binding, onMove, onClose, onShowChat }) {
      const [toc, setToc] = useState(null)
      const [chapter, setChapter] = useState(null)
      const index = binding.chapter ?? 0
      useEffect(() => { rpc('toc', { bookId: binding.bookId }).then(setToc) }, [binding.bookId])
      useEffect(() => {
        setChapter(null)
        rpc('chapter', { bookId: binding.bookId, index }).then(setChapter)
      }, [binding.bookId, index])
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
        h('div', { className: 'dr-page', key: index },
          h('article', { className: 'dr-text' },
            chapter === null ? '读取中…' : [h('h2', { key: 't' }, chapter.title), chapter.text.replace(/^[^\n]*\n/, '')])))
    }

    /** Centre occupant: the reader when the session has a book, otherwise the ordinary Conversation. */
    function ReaderCentre(props) {
      const { sessionId, rpc, store, openChat, openLibrary } = props
      const binding = useBinding(store, sessionId)

      const reading = sessionId !== undefined && binding?.bookId
      // On a phone the side panel goes fullscreen, so let the reader stay in front until asked.
      useEffect(() => { if (reading && !NARROW.matches) openChat() }, [reading, sessionId])

      // A session owns one composer editor; never mount the centre one while the binding is unknown.
      if (sessionId !== undefined && binding === undefined) return h('div', { className: 'dr-root' })
      if (!reading) return h(CentreConversation, { ...props, onOpenLibrary: openLibrary })
      return h(Reader, {
        rpc, binding,
        onMove: (chapter) => store.bind(sessionId, { chapter }),
        onClose: () => store.close(sessionId),
        onShowChat: openChat,
      })
    }

    return {
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        const rpc = async (endpoint, payload = {}) => {
          const res = await fetch(`${ROUTE}/${endpoint}`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          })
          const body = await res.json()
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
          return body.result
        }
        const openChat = () => ctx.sidebarRight.openTab(CHAT_KIND)
        const openLibrary = () => ctx.sidebarRight.openTab(LIBRARY_KIND)
        const closeChat = (sessionId) => {
          for (const tab of ctx.sidebarRight.openTabs.getSnapshot()) {
            if (tab.kind === CHAT_KIND && tab.sessionId === sessionId) ctx.sidebarRight.close(tab.tabId)
          }
        }

        const store = createBindingStore(rpc, closeChat)

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
          inject: () => ({ rpc, store, openChat, openLibrary }),
        }, ReaderCentre)), 'dsh-reader: centre reader')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: 'dsh-reader',
          kind: CHAT_KIND,
          title: () => '对话',
        }), 'dsh-reader: chat tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: 'dsh-reader',
          children: { [CHAT_SLOT]: { kind: 'single', scope: 'session' } },
        }, ChatTab)), 'dsh-reader: chat tab body')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: 'dsh-reader-library',
          kind: LIBRARY_KIND,
          title: () => '书库',
          guide: [{ id: 'library', order: 10, title: () => '书库', description: () => '选一本书，在中间打开阅读' }],
        }), 'dsh-reader: library tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: 'dsh-reader-library',
          inject: () => ({ rpc, store }),
        }, LibraryTab)), 'dsh-reader: library tab body')

        ctx.effect(() => ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT }, ChatConversation)),
          'dsh-reader: chat conversation')
      },
    }
  },
})
