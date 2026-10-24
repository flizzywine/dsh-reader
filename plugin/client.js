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
/* Floating layers (Aa panel, contents, dialogs) must not show the page through. Glass skins make the
   page and menu tokens translucent, so lay the skin's menu colour over the system's opaque canvas:
   the skin still tints the panel, the text underneath never shows. */
body{--dr-solid:linear-gradient(var(--dsw-menu-surface-fill,var(--dsw-alias-bg-base,transparent)) 0 0) Canvas}
.dr-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,inherit);color:var(--dsw-alias-label-primary)}
.dr-bar{display:flex;align-items:center;gap:8px;overflow-x:auto;padding:10px 16px;padding-left:max(16px,var(--dsh-frame-leading-clearance,0px));border-bottom:.5px solid var(--dr-line,var(--dsw-alias-border-l2));font-size:13px;flex:none;background:var(--dr-bg,transparent);color:var(--dr-fg,inherit)}
/* Only the reading surface takes the theme's light/dark; panels over it keep the app's, so their opaque base matches the skin. */
.dr-root[data-theme]:not([data-theme="auto"]) :is(.dr-bar,.dr-page){color-scheme:var(--dr-scheme)}
.dr-bar .dr-btn,.dr-bar .dr-toc-open{background:var(--dr-chip,var(--dsw-alias-bg-module-platform))}
.dr-bar .dr-btn:hover,.dr-bar .dr-toc-open:hover,.dr-bar .dr-nav:hover:not(:disabled){background:var(--dr-hover,var(--dsw-alias-interactive-bg-hover))}
.dr-bar .dr-toc-open em{color:var(--dr-muted,var(--dsw-alias-label-tertiary))}
.dr-aa{position:absolute;z-index:7;top:50px;right:12px;width:min(300px,calc(100% - 24px));padding:14px;border-radius:14px;background:var(--dr-solid);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 12px 32px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:12px;font-size:13px;animation:dr-fade .12s ease-out}
.dr-aa-row{display:flex;align-items:center;gap:10px}
.dr-aa-row>span:first-child{width:36px;flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dr-aa-swatches{display:flex;gap:8px;flex-wrap:wrap}
.dr-aa-swatch{width:34px;height:34px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;display:grid;place-items:center;font-size:11px;padding:0}
.dr-aa-swatch[aria-pressed="true"]{box-shadow:0 0 0 2px var(--dsw-alias-bg-base),0 0 0 3.5px var(--dsw-alias-label-primary)}
.dr-seg{display:flex;flex:1;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-module-platform)}
.dr-seg button{flex:1;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dr-seg button[aria-pressed="true"]{background:var(--dr-solid);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.15)}
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
.dr-toc{position:absolute;z-index:6;top:0;bottom:0;left:0;width:min(320px,88%);display:flex;flex-direction:column;background:var(--dr-solid);border-right:.5px solid var(--dsw-alias-border-l2);box-shadow:8px 0 24px rgba(0,0,0,.18);animation:dr-slide .18s ease-out}
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
.dr-dock{display:flex;justify-content:center;gap:8px;width:100%;max-width:var(--dsh-composer-card-max-width,780px);box-sizing:border-box;margin:0 auto;padding:8px 12px 0}
.dr-dock-btn{border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-brand-primary);cursor:pointer;padding:3px 9px;border-radius:7px;font:inherit;font-size:12px;font-weight:650}
.dr-dock-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.dr-dock-btn:disabled{opacity:.5;cursor:default}
.dr-toc-row .dr-toc-agent{color:var(--dsw-alias-label-primary);font-weight:600}
.dr-page{flex:1;overflow:auto;min-height:0;background:var(--dr-bg,transparent)}
.dr-text{box-sizing:content-box;max-width:var(--dr-measure,36em);margin:0 auto;padding:40px 28px 120px;font-family:var(--dr-font);font-size:var(--dr-size,18px);line-height:var(--dr-leading,1.9);color:var(--dr-fg,inherit);text-align:justify;text-justify:inter-character;word-break:break-word;hyphens:auto;font-feature-settings:"palt" 0}
.dr-text h2{font-size:1.4em;line-height:1.4;font-weight:600;margin:0 0 1.6em;text-align:left;letter-spacing:.02em}
.dr-text h3{font-size:1.1em;font-weight:600;margin:1.6em 0 .8em;text-align:left}
.dr-text p{margin:0 0 .55em;text-indent:2em}
.dr-text .dr-meta{text-indent:0;font-size:.78em;color:var(--dr-muted,var(--dsw-alias-label-tertiary));margin-bottom:1.2em}
.dr-text .dr-end{text-align:center;text-indent:0;margin-top:3em;font-size:.8em;color:var(--dr-muted,var(--dsw-alias-label-tertiary))}
.dr-text mark{color:inherit;background:none}
/* 划线: one colour; the agent's are dashed. dr-flash is show_passage's (and 定位's) passing highlight. */
.dr-root{--dr-hl-line:rgba(226,132,24,.85);--dr-hl-fill:rgba(255,170,40,.14)}
.dr-text mark.dr-hl{background:var(--dr-hl-fill);border-bottom:2px solid var(--dr-hl-line);cursor:pointer}
.dr-text mark.dr-hl-agent{border-bottom-style:dashed}
.dr-text mark.dr-flash{background:rgba(255,196,0,.28);border-radius:3px;box-shadow:0 0 0 2px rgba(255,196,0,.28);animation:dr-flash 1.6s ease-out 2}
.dr-hl-note{display:inline-flex;vertical-align:super;margin:0 1px;color:var(--dr-hl-line);cursor:pointer;user-select:none;-webkit-user-select:none}
.dr-tools{position:fixed;z-index:20;display:flex;gap:2px;padding:4px;border-radius:10px;background:#2b2a27;color:#f5f2ea;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:13px}
.dr-tools button{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:52px;padding:6px 8px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dr-tools button:hover{background:rgba(255,255,255,.12)}
.dr-pop-scrim{position:fixed;inset:0;z-index:19}
.dr-pop{position:fixed;z-index:20;width:min(340px,calc(100vw - 32px));box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:var(--dr-solid);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 10px 30px rgba(0,0,0,.22);font-size:13px}
.dr-pop-quote{margin:0;max-height:7.5em;overflow:auto;padding:4px 10px;border-left:3px solid var(--dr-hl-line);white-space:pre-line;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dr-pop-text{width:100%;box-sizing:border-box;resize:vertical;min-height:64px;padding:8px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;line-height:1.6}
.dr-pop-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dr-pop-row .dr-note{font-size:12px}
.dr-pop-row .dr-grow{flex:1}
.dr-danger{color:#c0392b!important}
.dr-toast{position:absolute;z-index:21;left:50%;bottom:24px;transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:#2b2a27;color:#f5f2ea;font-size:13px;cursor:pointer}
.dr-toc-tabs{flex:1;display:flex;gap:14px}
.dr-toc-tabs button{padding:0;border:0;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:15px;font-weight:650;cursor:pointer}
.dr-toc-tabs button[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.dr-notes-empty{padding:8px 16px}
.dr-notes-item{display:flex;flex-direction:column;gap:4px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dr-notes-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-notes-quote{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line;line-height:1.6;padding-left:8px;border-left:2px solid var(--dr-hl-line)}
.dr-notes-quote.dr-hl-agent{border-left-style:dashed}
.dr-notes-note{padding-left:10px;color:var(--dsw-alias-label-secondary);font-size:12.5px;white-space:pre-line}
.dr-notes-by{padding-left:10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
@keyframes dr-flash{0%{background:rgba(255,196,0,.6)}100%{background:rgba(255,196,0,.28)}}
.dr-lib{height:100%;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary)}
.dr-lib-head{display:flex;align-items:flex-start;gap:8px}
.dr-lib-head>div{flex:1}
.dr-lib-head h3{margin:0 0 4px;font-size:15px}
.dr-lib-head p,.dr-note{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-card{display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:color-mix(in srgb,currentColor 6%,transparent)}
.dr-card-on{outline:1px solid var(--dsw-alias-border-l2)}
.dr-card-text{flex:1;min-width:0}
.dr-card-title{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-card-link{border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:0;cursor:pointer}
.dr-card-link:hover .dr-card-title{text-decoration:underline;text-underline-offset:3px}
.dr-row{display:flex;gap:6px;flex:none}
.dr-back{align-self:flex-start;display:flex;align-items:center;gap:4px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;padding:2px 6px 2px 2px;border-radius:6px;cursor:pointer}
.dr-back:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-detail-head h3{margin:0 0 4px;font-size:17px}
.dr-detail-head p{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-detail-actions{display:flex;flex-wrap:wrap;gap:6px}
.dr-link{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px}
.dr-sum{border-radius:10px;background:color-mix(in srgb,currentColor 6%,transparent)}
.dr-sum-head:hover{background:color-mix(in srgb,currentColor 5%,transparent);border-radius:10px}
.dr-sum-head{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;background:transparent;color:inherit;font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.dr-sum-head .dr-toc-n{width:24px;flex:none;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dr-sum-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dr-mark{display:flex;flex-direction:column;gap:4px;font-size:13.5px}
.dr-mark-ch{margin-top:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-mark blockquote{margin:0;white-space:pre-line;padding:6px 10px;border-left:3px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 60%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);border-radius:0 6px 6px 0;line-height:1.7}
.dr-mark p{margin:0;padding-left:13px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dr-mark .dr-link{align-self:flex-start;margin-left:13px}
.dr-sum-body{padding:0 14px 14px 46px;display:flex;flex-direction:column;gap:8px}
.dr-md{font-size:13px;line-height:1.75;color:var(--dsw-alias-label-primary)}
.dr-md h4,.dr-md h5{margin:10px 0 4px;font-size:13px;font-weight:650;color:var(--dsw-alias-label-secondary)}
.dr-md h4:first-child,.dr-md h5:first-child{margin-top:0}
.dr-md p{margin:0 0 6px}
.dr-md ul,.dr-md ol{margin:0 0 6px;padding-left:1.3em}
.dr-md li{margin:2px 0}
.dr-md blockquote{margin:0 0 6px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dr-md code{font-size:12px;padding:0 4px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover)}
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
.dr-dialog{width:min(640px,100%);max-height:min(720px,90vh);display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:14px;background:var(--dr-solid);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2)}
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
      pen: 'M3.5 17h13M6 13.5l7.5-7.5 2 2-7.5 7.5H6z',
      copy: 'M7.5 7.5h8.5v8.5H7.5zM4.5 12.5v-8h8',
      chat: 'M4 4.5h12v8.5H9.5L6 16v-3H4z',
      up: 'M5 12.5 10 7.5l5 5',
      down: 'M5 7.5 10 12.5l5-5',
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
    /** Inline Markdown the agent's summaries use: **bold** and `code`. */
    function inlineMd(text) {
      return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? h('b', { key: i }, part.slice(2, -2))
          : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? h('code', { key: i }, part.slice(1, -1))
            : part)
    }

    /** Block Markdown for summaries: headings, bullet and numbered lists, quotes, paragraphs. */
    function Markdown({ text }) {
      const out = []
      let list = null
      let para = []
      const flushPara = () => { if (para.length) out.push(h('p', { key: out.length }, inlineMd(para.join('')))); para = [] }
      const flushList = () => { if (list) out.push(h(list.tag, { key: out.length }, list.items.map((item, i) => h('li', { key: i }, inlineMd(item))))); list = null }
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        const bullet = /^[-*+]\s+(.*)$/.exec(line)
        const numbered = /^\d+[.、)]\s*(.*)$/.exec(line)
        if (!line || /^-{3,}$/.test(line)) { flushPara(); flushList(); continue }
        if (heading) { flushPara(); flushList(); out.push(h(heading[1].length <= 2 ? 'h4' : 'h5', { key: out.length }, inlineMd(heading[2]))); continue }
        if (bullet || numbered) {
          flushPara()
          const tag = bullet ? 'ul' : 'ol'
          if (list?.tag !== tag) { flushList(); list = { tag, items: [] } }
          list.items.push((bullet ?? numbered)[1])
          continue
        }
        if (line.startsWith('>')) { flushPara(); flushList(); out.push(h('blockquote', { key: out.length }, inlineMd(line.replace(/^>\s?/, '')))); continue }
        flushList()
        para.push(line)
      }
      flushPara()
      flushList()
      return h('div', { className: 'dr-md' }, out)
    }

    /** A book's page in 书库: what it is, its 划线, and every summary the agent has written for it. */
    function BookDetail({ app, book, sessionId, binding, onBack, here, fresh }) {
      const [summaries, setSummaries] = useState(null)
      const [highlights, setHighlights] = useState(null)
      const [open, setOpen] = useState(() => new Set())
      useEffect(() => { app.rpc('summaries', { bookId: book.id }).then(setSummaries, () => setSummaries([])) }, [book.id])
      useEffect(() => { app.rpc('highlights', { bookId: book.id }).then(setHighlights, () => setHighlights([])) }, [book.id])
      const reading = binding?.bookId === book.id
      const toggle = (index) => setOpen((set) => {
        const next = new Set(set)
        next.has(index) ? next.delete(index) : next.add(index)
        return next
      })
      const allOpen = summaries?.length > 0 && summaries.every((s) => open.has(s.index))
      return h('div', { className: 'dr-lib' },
        h('button', { type: 'button', className: 'dr-back', onClick: onBack }, h(Icon, { name: 'left', size: 14 }), '书库'),
        h('div', { className: 'dr-detail-head' },
          h('h3', null, book.title),
          h('p', null, `${book.chars.toLocaleString()} 字 · ${book.chapters} 节` + (summaries ? ` · ${summaries.length} 节有总结` : '') + (highlights?.length ? ` · ${highlights.length} 条划线` : '')
            + (reading ? ` · 正在读第 ${(binding.chapter ?? 0) + 1} 节` : ''))),
        h('div', { className: 'dr-detail-actions' },
          reading ? null : h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => (binding?.bookId ? fresh(book.id) : here(book.id)) }, binding?.bookId ? '新开阅读' : '打开'),
          h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => app.rpc('reveal', { bookId: book.id, sub: '总结' }) }, '在 Finder 中打开总结文件夹')),
        h('div', { className: 'dr-side-label' }, h('span', null, '划线')),
        highlights === null ? h('p', { className: 'dr-note' }, '读取中…')
          : highlights.length === 0 ? h('p', { className: 'dr-note' }, '还没有划线。在对话里让 Agent「把这段标一下」，划好的线会出现在这里。')
            : highlights.map((m, i) => h('div', { key: m.id, className: 'dr-mark' },
              m.chapter === highlights[i - 1]?.chapter ? null : h('div', { className: 'dr-mark-ch' }, `${m.chapter + 1} · ${tocRows([{ title: m.title }])[0].name}`),
              h('blockquote', null, plainQuote(m.quote)),
              m.note ? h('p', null, m.note) : null,
              // Same anchor show_passage sets, so the reader highlights the line and scrolls to it.
              reading ? h('button', { type: 'button', className: 'dr-link', onClick: () => app.store.bind(sessionId, { chapter: m.chapter, anchor: { quote: m.quote, at: m.at, prefix: m.prefix, suffix: m.suffix, nonce: Date.now() } }) }, '在阅读区定位') : null)),
        h('div', { className: 'dr-side-label' },
          h('span', null, '总结'),
          summaries?.length ? h('button', { type: 'button', className: 'dr-link', onClick: () => setOpen(allOpen ? new Set() : new Set(summaries.map((s) => s.index))) }, allOpen ? '全部收起' : '全部展开') : null),
        summaries === null ? h('p', { className: 'dr-note' }, '读取中…')
          : summaries.length === 0 ? h('p', { className: 'dr-note' }, '还没有总结。在对话里让 Agent「把这一节总结一下」或「把前十节都总结了」，写好的总结会出现在这里。')
            : summaries.map((s) => h('div', { key: s.index, className: 'dr-sum' + (open.has(s.index) ? ' dr-sum-open' : '') },
              h('button', { type: 'button', className: 'dr-sum-head', 'aria-expanded': open.has(s.index), onClick: () => toggle(s.index) },
                h('span', { className: 'dr-toc-n' }, s.index + 1),
                h('span', { className: 'dr-sum-title' }, tocRows([s])[0].name),
                h(Icon, { name: open.has(s.index) ? 'up' : 'down', size: 14 })),
              open.has(s.index) ? h('div', { className: 'dr-sum-body' },
                h(Markdown, { text: s.text.replace(/^#\s+[^\n]*\n+/, '') }),
                reading ? h('button', { type: 'button', className: 'dr-link', onClick: () => app.store.bind(sessionId, { chapter: s.index }) }, '在阅读区打开这一节') : null) : null)))
    }

    /** Right Sidebar 书库 page: one card per book, like tavern's 人物卡库; a card opens the book's page. */
    function LibraryTab({ sessionId, app }) {
      const { books, error } = useLibrary(app)
      const binding = useBinding(app.store, sessionId)
      const [failure, setFailure] = useState(null)
      const [detail, setDetail] = useState(null)
      const current = binding?.bookId
      // Switching keeps each book's place (the host remembers positions per book); 新开 starts a separate session.
      const run = (work) => work.catch((e) => setFailure(String(e?.message ?? e)))
      const here = (bookId) => run(app.store.bind(sessionId, { bookId }))
      const fresh = (bookId) => run(app.startReading(bookId))
      const shown = detail && books?.find((b) => b.id === detail)
      if (shown) return h(BookDetail, { app, book: shown, sessionId, binding, onBack: () => setDetail(null), here, fresh })
      return h('div', { className: 'dr-lib' },
        h('div', { className: 'dr-lib-head' },
          h('div', null,
            h('h3', null, '书库'),
            h('p', null, '导入 TXT，或直接放进 dsh-reader/library/ 目录。点书名看详情和总结。')),
          h(ImportButton, { app, className: 'dr-btn dr-btn-line', label: '导入' })),
        failure ? h('p', { className: 'dr-error' }, failure) : null,
        error ? h('p', { className: 'dr-error' }, error)
          : books === null ? h('p', { className: 'dr-note' }, '读取中…')
            : books.length === 0 ? h('p', { className: 'dr-note' }, '书库是空的。')
              : books.map((b) => h('div', { key: b.id, className: 'dr-card' + (b.id === current ? ' dr-card-on' : '') },
                h('button', { type: 'button', className: 'dr-card-text dr-card-link', title: '看详情和总结', onClick: () => setDetail(b.id) },
                  h('div', { className: 'dr-card-title' }, (b.id === current ? '✓ ' : '') + b.title),
                  h('div', { className: 'dr-card-meta' }, `${b.chars.toLocaleString()} 字 · ${b.chapters} 节`
                    + (b.id === current ? ` · 读到第 ${(binding.chapter ?? 0) + 1} 节` : ''))),
                b.id === current
                  ? h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => app.store.close(sessionId) }, '合上')
                  : h('div', { className: 'dr-row' },
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

    /**
     * Where a quote sits in the chapter file now: its saved offset if the text there still matches,
     * else the copy whose prefix/suffix fit (W3C TextQuoteSelector style), nearest the old offset.
     */
    function findQuote(text, { quote, at = 0, prefix, suffix }) {
      if (!quote) return -1
      if (text.startsWith(quote, at)) return at
      const fits = (i) => (!prefix || text.slice(0, i).endsWith(prefix)) && (!suffix || text.startsWith(suffix, i + quote.length))
      let best = -1
      for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
        if (best < 0 || fits(i) > fits(best) || (fits(i) === fits(best) && Math.abs(i - at) < Math.abs(best - at))) best = i
      }
      return best
    }

    /** Highlights and the agent's show_passage anchor as `{ start, end }` spans of the chapter file. */
    function placeSpans(text, highlights, anchor) {
      const spans = []
      for (const m of highlights) {
        const start = findQuote(text, m)
        if (start >= 0) spans.push({ ...m, start, end: start + m.quote.length })
      }
      const start = anchor ? findQuote(text, anchor) : -1
      if (start >= 0) spans.push({ anchor: true, nonce: anchor.nonce, start, end: start + anchor.quote.length })
      return spans
    }

    /**
     * Render blocks with their spans. Each block carries `data-at` (its file offset), so a selection maps
     * back to file offsets; a span crossing paragraphs is drawn piece by piece in each block it covers.
     */
    function renderBlocks(list, spans) {
      return list.map((block, i) => {
        const tag = block.kind === 'sub' ? 'h3' : 'p'
        const props = { key: i, className: block.kind === 'meta' ? 'dr-meta' : undefined, 'data-at': block.at }
        const end = block.at + block.text.length
        const mine = spans.filter((span) => span.start < end && span.end > block.at)
        if (mine.length === 0) return h(tag, props, block.text)
        const cuts = [...new Set([block.at, end, ...mine.flatMap((span) => [span.start, span.end]).filter((x) => x > block.at && x < end)])].sort((a, b) => a - b)
        const parts = []
        for (let k = 0; k < cuts.length - 1; k += 1) {
          const from = cuts[k]
          const to = cuts[k + 1]
          const piece = block.text.slice(from - block.at, to - block.at)
          const over = mine.filter((span) => span.start <= from && span.end >= to)
          if (over.length === 0) { parts.push(piece); continue }
          const marks = over.filter((span) => span.id)
          const anchor = over.find((span) => span.anchor)
          parts.push(h('mark', {
            key: `${from}:${anchor?.nonce ?? ''}`,
            className: [marks.length && 'dr-hl', marks.length && marks.every((m) => m.by === 'agent') && 'dr-hl-agent', anchor && 'dr-flash'].filter(Boolean).join(' '),
            'data-ids': marks.map((m) => m.id).join(' ') || undefined,
            'data-dr-anchor': anchor ? '' : undefined,
          }, piece))
          // A highlight with a note ends in a small mark; it is not text, so selections skip it.
          for (const m of marks) {
            if (m.note && m.end === to) parts.push(h('span', { key: `n${m.id}`, className: 'dr-hl-note', 'data-dr-skip': '', 'data-ids': m.id, title: m.note }, h(Icon, { name: 'note', size: 12 })))
          }
        }
        return h(tag, props, ...parts)
      })
    }

    /** File offset of a DOM selection point inside the article, or null when it is outside the text. */
    function pointOffset(article, node, offset) {
      if (node === article) {
        // Between blocks (e.g. a triple-click): the next block's start.
        for (const child of [...article.children].slice(offset)) if (child.dataset.at !== undefined) return Number(child.dataset.at)
        return null
      }
      const block = (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-at]')
      if (!block || !article.contains(block)) return null
      const range = document.createRange()
      range.setStart(block, 0)
      range.setEnd(node, offset)
      const before = range.cloneContents()
      before.querySelectorAll('[data-dr-skip]').forEach((el) => el.remove())
      return Number(block.dataset.at) + before.textContent.length
    }

    const SPACE = /[\s\u3000]/
    /** The selected file span with surrounding blanks and indentation trimmed, or null. */
    function selectionSpan(article, text) {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
      const range = sel.getRangeAt(0)
      if (!article.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== article) return null
      let at = pointOffset(article, range.startContainer, range.startOffset)
      let end = pointOffset(article, range.endContainer, range.endOffset)
      if (at === null || end === null) return null
      while (at < end && SPACE.test(text[at])) at += 1
      while (end > at && SPACE.test(text[end - 1])) end -= 1
      if (end <= at) return null
      const rects = [...range.getClientRects()].filter((r) => r.width > 0)
      return { at, end, rect: rects[0] ?? range.getBoundingClientRect(), last: rects.at(-1) ?? range.getBoundingClientRect() }
    }

    /** A quote as plain lines, without the book's indentation. */
    const plainQuote = (quote) => quote.split('\n').map((line) => line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')).filter(Boolean).join('\n')

    /** Floats above `rect` (or below it near the top of the window). */
    function Floating({ rect, below, className, children }) {
      const up = rect.top > 90
      const anchor = up ? rect : (below ?? rect)
      const style = { left: `clamp(150px, ${anchor.left + anchor.width / 2}px, calc(100vw - 150px))`, top: up ? anchor.top - 10 : anchor.bottom + 10, transform: up ? 'translate(-50%, -100%)' : 'translate(-50%, 0)' }
      // mousedown would clear the text selection before the click lands.
      return h('div', { className, style, onMouseDown: (e) => { if (e.target.tagName !== 'TEXTAREA') e.preventDefault() } }, children)
    }

    /** Edits a note: for a new highlight (with its quote) or an existing one. */
    function NoteEditor({ quote, initial, onSave, onCancel, extra }) {
      const [value, setValue] = useState(initial ?? '')
      return h(React.Fragment, null,
        h('blockquote', { className: 'dr-pop-quote' }, plainQuote(quote)),
        h('textarea', {
          className: 'dr-pop-text', rows: 3, autoFocus: true, placeholder: '写下你的想法…', value,
          onChange: (e) => setValue(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(value); if (e.key === 'Escape') onCancel() },
        }),
        extra ? h('div', { className: 'dr-pop-row' }, extra) : null,
        h('div', { className: 'dr-pop-row' },
          h('span', { className: 'dr-grow' }),
          h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: onCancel }, '取消'),
          h('button', { type: 'button', className: 'dr-btn', onClick: () => onSave(value) }, '保存')))
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
    function TocDrawer({ rpc, bookId, index, agentIndex, highlights, onPick, onLocate, onClose }) {
      const [toc, setToc] = useState(null)
      const [query, setQuery] = useState('')
      const [tab, setTab] = useState('toc')
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
            h('div', { className: 'dr-toc-tabs', role: 'tablist' },
              h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'toc', onClick: () => setTab('toc') }, '目录'),
              h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'notes', onClick: () => setTab('notes') }, `笔记${highlights.length ? ` ${highlights.length}` : ''}`)),
            h('span', null, tab === 'toc' ? `${total} 节${done ? ` · ${done} 节有总结` : ''}` : `${highlights.filter((m) => m.note).length} 条想法`),
            h('button', { type: 'button', className: 'dr-nav', 'aria-label': '关闭目录', onClick: onClose }, h(Icon, { name: 'close' }))),
          h('input', { className: 'dr-toc-search', placeholder: tab === 'toc' ? '搜章名或序号' : '搜划线或想法', value: query, autoFocus: !NARROW.matches, onChange: (e) => setQuery(e.target.value) }),
          tab === 'notes' ? h(NotesList, { rows, highlights, query: q, onLocate: (m) => { onLocate(m); onClose() } }) : h(React.Fragment, null,
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
                  row.index === agentIndex ? h('span', { className: 'dr-toc-tag dr-toc-agent', title: 'Agent 最近读的一节' }, now ? '在读 · Agent' : 'Agent') : null,
                  now ? (row.index === agentIndex ? null : h('span', { className: 'dr-toc-tag' }, '在读'))
                    : row.summarized ? h('span', { className: 'dr-toc-tag', title: '已有总结' }, h(Icon, { name: 'note', size: 14 })) : null))
                  return out
                })))))
    }

    /** 笔记: every highlight of the book in reading order, grouped by chapter; a click goes to it. */
    function NotesList({ rows, highlights, query, onLocate }) {
      const shown = query ? highlights.filter((m) => m.quote.includes(query) || m.note?.includes(query)) : highlights
      if (highlights.length === 0) return h('p', { className: 'dr-note dr-notes-empty' }, '还没有划线。选中正文里的文字，就能划线或写想法。')
      if (shown.length === 0) return h('p', { className: 'dr-note dr-notes-empty' }, '没有匹配的划线。')
      return h('div', { className: 'dr-toc-list dr-notes' }, shown.flatMap((m, i) => [
        m.chapter === shown[i - 1]?.chapter ? null : h('div', { key: `c${m.chapter}`, className: 'dr-toc-vol' }, `${m.chapter + 1} · ${rows[m.chapter]?.name ?? ''}`),
        h('button', { key: m.id, type: 'button', className: 'dr-notes-item', onClick: () => onLocate(m) },
          h('span', { className: 'dr-notes-quote' + (m.by === 'agent' ? ' dr-hl-agent' : '') }, plainQuote(m.quote)),
          m.note ? h('span', { className: 'dr-notes-note' }, m.note) : null,
          m.by === 'agent' ? h('span', { className: 'dr-notes-by' }, 'Agent 划的') : null),
      ]))
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
          '--dr-scheme': dark ? 'dark' : 'light',
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

    function Reader({ rpc, binding, onMove, onLocate, onAsk, onClose, onShowChat }) {
      const t = useTypography()
      const [panel, setPanel] = useState(false)
      const [drawer, setDrawer] = useState(false)
      const [toc, setToc] = useState(null)
      const [chapter, setChapter] = useState(null)
      const [highlights, setHighlights] = useState([])
      const [marksVersion, setMarksVersion] = useState(0)
      // The selection toolbar, or a card: a new note on the selection, or one highlight opened by a click.
      const [selection, setSelection] = useState(null)
      const [card, setCard] = useState(null)
      const [copied, setCopied] = useState(false)
      const [failure, setFailure] = useState(null)
      const page = useRef(null)
      const article = useRef(null)
      const index = binding.chapter ?? 0
      const anchor = binding.anchor ?? null
      const agentIndex = binding.agentPositions?.[binding.bookId]
      const bookId = binding.bookId
      useEffect(() => { rpc('toc', { bookId }).then(setToc) }, [bookId])
      useEffect(() => {
        setChapter(null)
        setSelection(null)
        setCard(null)
        rpc('chapter', { bookId, index }).then(setChapter)
      }, [bookId, index])
      // Reload on the agent's add/remove (binding.marks) and on our own changes.
      useEffect(() => { rpc('highlights', { bookId }).then(setHighlights, () => setHighlights([])) }, [bookId, binding.marks, marksVersion])
      // Bring the agent's passage to the middle of the page once its chapter is on screen.
      useEffect(() => {
        if (chapter === null || chapter.index !== index || !anchor) return
        page.current?.querySelector('[data-dr-anchor]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, [chapter, anchor?.nonce])
      const ready = chapter !== null && chapter.index === index
      const text = ready ? chapter.text : ''
      // Follow the text selection; selectionchange also covers touch and keyboard selections.
      useEffect(() => {
        if (!ready) return
        let timer
        const update = () => {
          clearTimeout(timer)
          timer = setTimeout(() => setSelection(article.current ? selectionSpan(article.current, text) : null), 120)
        }
        document.addEventListener('selectionchange', update)
        return () => { clearTimeout(timer); document.removeEventListener('selectionchange', update) }
      }, [ready, text])
      // Floating layers sit at fixed positions: re-place the toolbar on scroll, drop a card.
      const onScroll = () => {
        if (selection && article.current) setSelection(selectionSpan(article.current, text))
        if (card) setCard(null)
      }
      useEffect(() => {
        if (!card) return
        const onKey = (event) => { if (event.key === 'Escape') setCard(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [card])

      const changed = () => setMarksVersion((v) => v + 1)
      const run = (work) => work.then(changed).catch((e) => setFailure(String(e?.message ?? e)))
      const clearSelection = () => { document.getSelection()?.removeAllRanges(); setSelection(null) }
      const mark = (span, note = '') => run(rpc('highlight-add', { bookId, chapter: index, at: span.at, end: span.end, note }).then(clearSelection))
      const copy = (quote) => {
        navigator.clipboard?.writeText(plainQuote(quote)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }, () => setFailure('复制失败'))
      }
      const ask = (quote) => { onAsk(plainQuote(quote)); clearSelection(); setCard(null) }
      // A click on a highlight (not the end of a selection) opens it; overlapping ones open the shortest.
      const onArticleClick = (event) => {
        const hit = event.target.closest?.('[data-ids]')
        if (!hit || !document.getSelection()?.isCollapsed) return
        const ids = hit.dataset.ids.split(' ')
        const picked = highlights.filter((m) => ids.includes(m.id)).sort((a, b) => a.quote.length - b.quote.length)[0]
        if (picked) setCard({ kind: 'mark', id: picked.id, rect: hit.getBoundingClientRect() })
      }

      const count = toc?.chapters.length ?? 0
      const current = toc ? tocRows(toc.chapters)[index] : null
      const spans = ready ? placeSpans(text, highlights.filter((m) => m.chapter === index), anchor) : []
      const opened = card?.kind === 'mark' ? highlights.find((m) => m.id === card.id) : null
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
        h('div', { className: 'dr-page', key: index, ref: page, onScroll },
          h('article', { className: 'dr-text', ref: article, onClick: onArticleClick },
            !ready ? h('p', { className: 'dr-meta' }, '读取中…') : [
              h('h2', { key: 't' }, current?.full ?? chapter.title),
              ...renderBlocks(blocks(text, chapter.title), spans),
              h('p', { key: 'end', className: 'dr-end' }, index >= count - 1 ? '全书完' : `本节完 · 下一节「${toc ? tocRows(toc.chapters)[index + 1]?.name ?? '' : ''}」`),
            ])),
        selection && !card ? h(Floating, { rect: selection.rect, below: selection.last, className: 'dr-tools' },
          h('button', { type: 'button', onClick: () => mark(selection) }, h(Icon, { name: 'pen', size: 15 }), '划线'),
          h('button', { type: 'button', onClick: () => setCard({ kind: 'new', span: selection, rect: selection.rect, last: selection.last }) }, h(Icon, { name: 'note', size: 15 }), '写想法'),
          h('button', { type: 'button', onClick: () => copy(text.slice(selection.at, selection.end)) }, h(Icon, { name: 'copy', size: 15 }), copied ? '已复制' : '复制'),
          h('button', { type: 'button', onClick: () => ask(text.slice(selection.at, selection.end)) }, h(Icon, { name: 'chat', size: 15 }), '问 Agent')) : null,
        card ? h('div', { className: 'dr-pop-scrim', onMouseDown: () => setCard(null) }) : null,
        card?.kind === 'new' ? h(Floating, { rect: card.rect, below: card.last, className: 'dr-pop' },
          h(NoteEditor, {
            quote: text.slice(card.span.at, card.span.end),
            onCancel: () => setCard(null),
            onSave: (note) => { mark(card.span, note); setCard(null) },
          })) : null,
        opened ? h(Floating, { rect: card.rect, className: 'dr-pop' },
          h(NoteEditor, {
            key: opened.id,
            quote: opened.quote,
            initial: opened.note,
            onCancel: () => setCard(null),
            onSave: (note) => { run(rpc('highlight-note', { bookId, id: opened.id, note })); setCard(null) },
            extra: h(React.Fragment, null,
              h('button', { type: 'button', className: 'dr-link dr-danger', onClick: () => { run(rpc('highlight-remove', { bookId, id: opened.id })); setCard(null) } }, '删除划线'),
              h('button', { type: 'button', className: 'dr-link', onClick: () => copy(opened.quote) }, copied ? '已复制' : '复制'),
              h('button', { type: 'button', className: 'dr-link', onClick: () => ask(opened.quote) }, '问 Agent'),
              opened.by === 'agent' ? h('span', { className: 'dr-note' }, 'Agent 划的') : null),
          })) : null,
        failure ? h('div', { className: 'dr-toast', role: 'alert', onClick: () => setFailure(null) }, failure) : null,
        drawer ? h(TocDrawer, { rpc, bookId, index, agentIndex, highlights, onPick: onMove, onLocate, onClose: () => setDrawer(false) }) : null,
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
        onLocate: (m) => app.store.bind(sessionId, { chapter: m.chapter, anchor: { quote: m.quote, at: m.at, prefix: m.prefix, suffix: m.suffix, nonce: Date.now() } }),
        onAsk: (quote) => app.askAgent(sessionId, quote),
        onClose: () => app.store.close(sessionId),
        onShowChat: app.openChat,
      })
    }

    /** Above the composer, like tavern's 生成候选项: jump the reader to the chapter the agent last read. */
    function AgentJump({ app, sessionId }) {
      const binding = useBinding(app.store, sessionId)
      const agentIndex = binding?.agentPositions?.[binding.bookId]
      if (!binding?.bookId || agentIndex === undefined) return null
      const here = agentIndex === (binding.chapter ?? 0)
      return h('div', { className: 'dr-dock' },
        h('button', {
          type: 'button', className: 'dr-dock-btn', disabled: here,
          title: here ? '你和 Agent 在读同一节' : '阅读区跳到 Agent 最近读的那一节',
          onClick: () => app.store.bind(sessionId, { chapter: agentIndex }),
        }, here ? `Agent 也在读第 ${agentIndex + 1} 节` : `跳到 Agent 在读的第 ${agentIndex + 1} 节`))
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
          /** 问 Agent: put the passage into this session's composer as a quote, ready for the question. */
          askAgent(sessionId, quote) {
            try {
              const input = ctx.get('conversation').input.for(ctx.sessions.scope(sessionId))
              const draft = input.state.getSnapshot().draft
              const block = `${quote.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
              input.setDraft(draft.trim() ? `${draft.replace(/\s*$/, '')}\n\n${block}` : block)
            } catch (error) {
              console.warn('dsh-reader: ask agent failed', error)
              window.alert('没能放进输入框，请复制后自己粘贴。')
            }
            app.openChat()
          },
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

        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'dsh-reader-agent-jump', order: -130, label: '跳到 Agent 在读的章节',
        }, (props) => h(AgentJump, { app, sessionId: props.sessionId }))), 'dsh-reader: agent jump above composer')

        ctx.effect(() => ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT }, ChatConversation)),
          'dsh-reader: chat conversation')
      },
    }
  },
})
