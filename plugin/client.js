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
    const { useState, useEffect, useCallback } = React

    const ROUTE = '/api/dsh-reader'
    const CHAT_KIND = 'dsh-reader-chat'
    const CHAT_SLOT = 'dsh-reader.chat.conversation'
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
.dr-pick{max-width:560px;margin:0 auto;padding:48px 24px}
.dr-pick li{list-style:none;margin:6px 0}
.dr-pick ul{padding:0}
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

    function LibraryPicker({ rpc, onPick, onCancel }) {
      const [books, setBooks] = useState(null)
      const [error, setError] = useState(null)
      useEffect(() => { rpc('library').then(setBooks, (e) => setError(String(e?.message ?? e))) }, [])
      return h('div', { className: 'dr-page' }, h('div', { className: 'dr-pick' },
        h('h2', null, '书库'),
        error ? h('p', null, error) : books === null ? h('p', null, '读取中…')
          : books.length === 0 ? h('p', null, '书库是空的：把 TXT 放进 dsh-reader/library/ 目录。')
            : h('ul', null, books.map((b) => h('li', { key: b.id },
              h('button', { type: 'button', className: 'dr-btn', onClick: () => onPick(b.id) }, b.title)))),
        h('p', null, h('button', { type: 'button', className: 'dr-btn', onClick: onCancel }, '返回对话'))))
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
      const { sessionId, rpc, openChat, closeChat } = props
      const [binding, setBinding] = useState(undefined)
      const [picking, setPicking] = useState(false)

      useEffect(() => {
        setBinding(undefined)
        setPicking(false)
        if (sessionId === undefined) return
        let live = true
        rpc('binding', { sessionId }).then((b) => { if (live) setBinding(b) })
        return () => { live = false }
      }, [sessionId])

      const bind = useCallback((patch) => {
        rpc('bind', { sessionId, binding: patch }).then(setBinding)
      }, [sessionId])

      const reading = sessionId !== undefined && binding?.bookId
      // On a phone the side panel goes fullscreen, so let the reader stay in front until asked.
      useEffect(() => { if (reading && !NARROW.matches) openChat() }, [reading, sessionId])

      if (picking) {
        return h('div', { className: 'dr-root' }, h(LibraryPicker, {
          rpc,
          onPick: (bookId) => { setPicking(false); bind({ bookId, chapter: 0 }) },
          onCancel: () => setPicking(false),
        }))
      }
      // A session owns one composer editor; never mount the centre one while the binding is unknown.
      if (sessionId !== undefined && binding === undefined) return h('div', { className: 'dr-root' })
      if (!reading) return h(CentreConversation, { ...props, onOpenLibrary: () => setPicking(true) })
      return h(Reader, {
        rpc, binding,
        onMove: (chapter) => bind({ chapter }),
        // Unmount the side composer before the centre one takes the session's editor back.
        onClose: () => { closeChat(sessionId); rpc('bind', { sessionId, binding: null }).then(setBinding) },
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
        const closeChat = (sessionId) => {
          for (const tab of ctx.sidebarRight.openTabs.getSnapshot()) {
            if (tab.kind === CHAT_KIND && tab.sessionId === sessionId) ctx.sidebarRight.close(tab.tabId)
          }
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
          inject: () => ({ rpc, openChat, closeChat }),
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

        ctx.effect(() => ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT }, ChatConversation)),
          'dsh-reader: chat conversation')
      },
    }
  },
})
