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
body{--dr-hl-line:rgba(226,132,24,.85);--dr-hl-fill:rgba(255,170,40,.14)}
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
.dr-btn-icon{display:inline-flex;align-items:center;gap:4px}
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
.dr-dock{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;width:100%;max-width:var(--dsh-composer-card-max-width,780px);box-sizing:border-box;margin:0 auto;padding:8px 12px 0}
.dr-dock-btn{white-space:nowrap;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-brand-primary);cursor:pointer;padding:3px 9px;border-radius:7px;font:inherit;font-size:12px;font-weight:650}
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
.dr-text mark.dr-hl{background:var(--dr-hl-fill);border-bottom:2px solid var(--dr-hl-line);cursor:pointer}
.dr-text mark.dr-hl-agent{border-bottom-style:dashed}
.dr-text mark.dr-flash{background:rgba(255,196,0,.28);border-radius:3px;box-shadow:0 0 0 2px rgba(255,196,0,.28);animation:dr-flash 1.6s ease-out 2}
.dr-hl-note{display:inline-flex;vertical-align:super;margin:0 1px;color:var(--dr-hl-line);cursor:pointer;user-select:none;-webkit-user-select:none}
.dr-tools{position:fixed;z-index:20;display:flex;gap:2px;padding:4px;border-radius:10px;background:#2b2a27;color:#f5f2ea;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:13px}
.dr-tools button{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:52px;padding:6px 8px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dr-tools button:hover{background:rgba(255,255,255,.12)}
.dr-pop-scrim{position:fixed;inset:0;z-index:19}
.dr-pop{position:fixed;z-index:20;width:min(360px,calc(100vw - 32px));box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:14px;background:var(--dr-solid);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 12px 36px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.06);font-size:13px}
.dr-pop-quote{margin:0;max-height:7.5em;overflow:auto;padding:4px 10px;border-left:3px solid var(--dr-hl-line);white-space:pre-line;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dr-pop-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-pop-head b{flex:1;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dr-pop-head b svg{color:var(--dr-hl-line)}
.dr-pop-text{width:100%;box-sizing:border-box;resize:none;min-height:88px;padding:10px 12px;border-radius:10px;border:1px solid transparent;background:color-mix(in srgb,currentColor 5%,transparent);color:inherit;font:inherit;font-size:14px;line-height:1.7;outline:none;transition:border-color .15s,background .15s}
.dr-pop-text:focus{border-color:color-mix(in srgb,var(--dr-hl-line) 55%,transparent);background:color-mix(in srgb,currentColor 2%,transparent)}
.dr-pop-text::placeholder{color:var(--dsw-alias-label-tertiary)}
.dr-pop-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dr-pop-cancel,.dr-pop-save{height:30px;padding:0 14px;border-radius:8px;font:inherit;font-size:13px;cursor:pointer}
.dr-pop-cancel{border:0;background:transparent;color:var(--dsw-alias-label-secondary)}
.dr-pop-cancel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dr-pop-save{border:0;background:#c56f16;color:#fff;font-weight:600}
.dr-pop-save:hover:not(:disabled){filter:brightness(1.06)}
.dr-pop-save:disabled{opacity:.4;cursor:default}
.dr-pop-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
/* 随想 (notes on no quote): a dashed 写随想 button, then plain cards with when/where they were written. */
.dr-booknotes{display:flex;flex-direction:column;gap:8px}
.dr-notes .dr-booknotes{padding:2px 6px 10px}
.dr-booknote-add{display:flex;align-items:center;justify-content:center;gap:6px;height:34px;border:1px dashed var(--dsw-alias-border-l2);border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dr-booknote-add:hover{border-color:var(--dr-hl-line);color:var(--dsw-alias-label-primary)}
.dr-booknote{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--dr-hl-line) 7%,transparent);border:.5px solid color-mix(in srgb,var(--dr-hl-line) 25%,transparent)}
.dr-booknote>p{margin:0;font-size:13.5px;line-height:1.75;white-space:pre-line}
.dr-booknote-foot{display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dr-booknote-foot span{flex:1}
.dr-booknote-foot button{padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
.dr-booknote-foot button:hover{color:var(--dsw-alias-label-primary)}
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
.dr-link{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px}
/* Book detail (书库 → 书名) */
.dr-bd{gap:14px;padding:16px 18px 32px}
.dr-bd-head{display:flex;flex-direction:column;gap:6px}
.dr-bd-head h3{margin:2px 0 0;font-size:19px;line-height:1.35;font-weight:700;letter-spacing:.01em}
.dr-bd-head>p{margin:0;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
.dr-bd-progress{margin-top:6px;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dr-bd-progress div{display:flex;justify-content:space-between}
.dr-bd-progress i{display:block;height:4px;border-radius:2px;background:color-mix(in srgb,currentColor 12%,transparent);overflow:hidden}
.dr-bd-progress b{display:block;height:100%;border-radius:2px;background:var(--dr-hl-line)}
.dr-bd-actions{margin-top:6px;display:flex;gap:8px}
.dr-bd-tabs{position:sticky;top:0;z-index:1;display:flex;gap:4px;padding:4px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dr-solid)}
.dr-bd-tabs button{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;height:30px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dr-bd-tabs button[aria-selected="true"]{background:color-mix(in srgb,currentColor 9%,transparent);color:var(--dsw-alias-label-primary);font-weight:650}
.dr-bd-tabs em{font-style:normal;font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}
.dr-bd-empty{margin:18px 4px;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-tertiary);text-align:center}
.dr-bd-list{display:flex;flex-direction:column;gap:10px}
.dr-bd-chapter{margin:8px 2px 0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dr-bd-chapter:first-child{margin-top:0}
.dr-bd-mark,.dr-bd-note{display:flex;flex-direction:column;gap:8px;padding:12px 14px 10px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,currentColor 2.5%,transparent)}
.dr-bd blockquote{margin:0;padding-left:12px;border-left:2px solid var(--dr-hl-line);white-space:pre-line;font-size:14px;line-height:1.8}
.dr-bd-agent blockquote{border-left-style:dashed}
.dr-bd-mark-note{margin:0;display:flex;gap:6px;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.dr-bd-mark-note svg{flex:none;margin-top:3px;color:var(--dr-hl-line)}
.dr-bd-note>p{margin:0;font-size:14px;line-height:1.75;white-space:pre-line}
.dr-bd-note blockquote{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.dr-bd-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-height:4px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dr-bd-foot span{flex:1}
.dr-bd-locate{width:28px;height:28px;margin:-4px -6px -4px 0;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dr-bd-locate:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dr-bd-tools{display:flex;justify-content:flex-end;gap:4px;margin-bottom:-6px}
.dr-bd-tool{display:flex;align-items:center;gap:5px;align-self:flex-start;height:28px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer}
.dr-bd-tool:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dr-bd-sums{border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);overflow:hidden}
.dr-bd-sum+.dr-bd-sum{border-top:.5px solid var(--dsw-alias-border-l2)}
.dr-bd-sum-head{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:0 14px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;text-align:left;cursor:pointer}
.dr-bd-sum-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-bd-n{width:26px;flex:none;text-align:right;font-size:12px;font-variant-numeric:tabular-nums}
.dr-bd-sum-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;color:var(--dsw-alias-label-primary)}
.dr-bd-sum-open .dr-bd-sum-head{font-weight:600}
.dr-bd-sum-body{display:flex;flex-direction:column;gap:6px;padding:2px 16px 14px 52px}
.dr-bd-sum-body .dr-bd-tool{margin-left:-9px}
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
/* The whole-book note sheet: a writing pad, not a popover. */
.dr-sheet-overlay{background:rgba(20,16,10,.38);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:dr-fade .15s ease-out}
.dr-sheet{width:min(720px,100%);max-height:min(820px,88vh);box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:26px 32px 20px;border-radius:18px;background:var(--dr-solid);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 24px 70px rgba(0,0,0,.28)}
.dr-sheet-head{display:flex;align-items:baseline;gap:12px;padding-bottom:14px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dr-sheet-head b{flex:1;display:flex;align-items:center;gap:8px;font-size:17px;font-weight:650}
.dr-sheet-head b svg{color:var(--dr-hl-line)}
.dr-sheet-head span{font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
.dr-sheet-text{flex:1;width:100%;min-height:min(320px,40vh);max-height:60vh;box-sizing:border-box;overflow:auto;resize:none;padding:4px 2px;border:0;outline:none;background:transparent;color:inherit;font-size:17px;line-height:1.95;letter-spacing:.01em}
.dr-sheet-text::placeholder{color:var(--dsw-alias-label-tertiary)}
.dr-sheet-foot{display:flex;align-items:center;gap:8px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-sheet-foot .dr-grow{flex:1}
.dr-sheet .dr-pop-cancel,.dr-sheet .dr-pop-save{height:34px;padding:0 18px;font-size:14px}
@media (max-width:767px){.dr-sheet{padding:20px 18px 16px;max-height:92vh}.dr-sheet-text{font-size:16px}}
/* Below 768px DSH draws the right column fullscreen over the reader; the skin's glass pane lets the page show through.
   Paint the pane, which slides off-screen when collapsed, never the panel: that one spans the screen even while collapsed. */
@media (max-width:767px){body.dsh-reader-shell-active [data-slot="rightbar"] [class*="_tabHost_"]{background:var(--dr-solid)}}
/* dsh-pocket lifts the phone drawer to z-index 1200, above DSH's popup menus (1100), dialog overlays (1000) and
   ours (1000): what the drawer opens (已登录 DeepSeek's menu, 设置, 选择一本书) landed underneath it.
   Popups are transient; float them all over the drawer. */
@media (max-width:1023px){body.dsh-reader-shell-active :is([role="menu"],:has(>[aria-modal="true"]),.dr-overlay){z-index:1300!important}}
.dr-dialog-head h3{margin:0;font-size:16px;flex:1}
.dr-dialog-list{overflow:auto;display:flex;flex-direction:column;gap:8px}
.dr-bb-tools{display:flex;gap:6px;align-items:center;flex:none}
.dr-bb-search{flex:1;min-width:0;height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-specific-input-major,transparent);color:inherit;font:inherit;font-size:13px}
.dr-gf{position:relative;flex:none}
.dr-gf-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;width:112px;height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-specific-input-major,transparent);color:inherit;font:inherit;font-size:13px;cursor:pointer}
.dr-gf-summary span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-gf-summary svg{opacity:.6;flex:none}
.dr-gf-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:50;width:min(220px,75vw);box-sizing:border-box;padding:5px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;background:var(--dr-solid);box-shadow:0 8px 24px #0003}
.dr-gf-options{max-height:280px;overflow-y:auto}
.dr-gf-menu button{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:6px 10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dr-gf-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-gf-menu button[aria-pressed="true"]{font-weight:600;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent)}
.dr-gf-menu em{font-style:normal;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dr-gf-menu button>span{width:16px;margin-left:auto;text-align:center}
.dr-gf-footer{border-top:1px solid color-mix(in srgb,currentColor 10%,transparent);margin:5px 5px 0;padding-top:5px}
.dr-gf-footer button{font-size:12px;color:var(--dsw-alias-label-secondary);padding-left:6px}
.dr-bb-batch{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:none;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.dr-bb-batch label{display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer}
.dr-bb-batch .dr-note{flex:1}
.dr-bb-batch select{height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12.5px}
.dr-card-pick{cursor:pointer}
.dr-bb-list{display:flex;flex-direction:column;gap:10px}
.dr-overlay-top{z-index:1100}
.dr-gm{width:min(440px,100%)}
.dr-gm-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dr-gm-row>span{flex:1;min-width:0;overflow-wrap:anywhere}
.dr-bd-group{align-self:flex-start;max-width:100%}
.dr-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;height:26px;box-sizing:border-box;padding:0 9px 0 8px;border:0;border-radius:999px;background:color-mix(in srgb,currentColor 7%,transparent);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer}
.dr-chip:hover,.dr-chip[aria-expanded="true"]{background:color-mix(in srgb,currentColor 12%,transparent);color:var(--dsw-alias-label-primary)}
.dr-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-chip svg{flex:none;opacity:.7}
.dr-gm-row .dr-chip-menu{flex:none}
.dr-gm-row .dr-gf-menu{left:auto;right:0}
.dr-gf-heading{padding:6px 10px 2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dr-persona-row small{font-size:11px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent)}
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
    function createBindingStore(rpc) {
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
      }
    }

    function useBinding(store, sessionId) {
      useSignal(store.changed)
      useEffect(() => { if (sessionId !== undefined) store.load(sessionId) }, [sessionId])
      return sessionId === undefined ? undefined : store.get(sessionId)
    }

    /** Book list and 书库 groups, re-read whenever an import or a group change lands. */
    function useLibrary(app) {
      const version = useSignal(app.libraryChanged)
      const [state, setState] = useState({ books: null, groups: [], error: null })
      useEffect(() => {
        let live = true
        Promise.all([app.rpc('library'), app.rpc('groups')]).then(([books, groups]) => live && setState({ books, groups, error: null }),
          (e) => live && setState({ books: [], groups: [], error: String(e?.message ?? e) }))
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
      const [progress, setProgress] = useState(null)
      const [error, setError] = useState(null)
      async function pick(event) {
        const files = [...event.target.files]
        event.target.value = ''
        if (!files.length) return
        setBusy(true)
        setError(null)
        try {
          let last
          for (const file of files) last = await app.importFile(file, setProgress)
          onImported?.(last)
        } catch (e) { setError(String(e?.message ?? e)) } finally { setBusy(false); setProgress(null) }
      }
      return h(React.Fragment, null,
        h('input', { ref: input, type: 'file', accept: '.txt,.epub,.pdf,text/plain,application/epub+zip,application/pdf', multiple: true, hidden: true, onChange: pick }),
        h('button', { type: 'button', className: className ?? 'dr-btn', disabled: busy, onClick: () => input.current?.click() }, busy ? (progress?.total ? `识别文字 ${progress.done}/${progress.total} 页…` : '导入中…') : label),
        error ? h('p', { className: 'dr-error' }, error) : null)
    }

    const ALL = '\u0000all'
    const UNGROUPED = '\u0000none'

    /** Run a 书库 change, then re-read the library; failures are shown as an alert, as elsewhere. */
    const libraryWork = (app, work) => work.then(() => app.libraryChanged.bump(), (e) => window.alert(String(e?.message ?? e)))
    const askGroupName = (current = '') => window.prompt(current ? '新的分组名' : '新分组的名字（比如：八字、周易、佛学）', current)?.trim()

    /** Open state for a dropdown in `ref`, closed by a press anywhere outside it. */
    function useDropdown(ref) {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        if (!open) return
        const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
        document.addEventListener('pointerdown', away)
        return () => document.removeEventListener('pointerdown', away)
      }, [open])
      return [open, setOpen]
    }

    /** 分组 dropdown like tavern's: 全部, 未分组, each group, then 创建分组 / 管理分组. */
    function GroupFilter({ app, books, groups, value, onChange, onManage }) {
      const ref = useRef(null)
      const [open, setOpen] = useDropdown(ref)
      const count = (group) => books.filter((b) => group === ALL || (b.group ?? UNGROUPED) === group).length
      const label = (group) => group === ALL ? '全部' : group === UNGROUPED ? '未分组' : group
      const pick = (group) => { onChange(group); setOpen(false) }
      const option = (group) => h('button', { key: group, type: 'button', 'aria-pressed': value === group, onClick: () => pick(group) },
        label(group), h('em', null, count(group)), h('span', null, value === group ? '✓' : ''))
      return h('div', { ref, className: 'dr-gf' },
        h('button', { type: 'button', className: 'dr-gf-summary', 'aria-expanded': open, onClick: () => setOpen(!open) },
          h('span', null, label(value)), h(Icon, { name: open ? 'up' : 'down', size: 14 })),
        open ? h('div', { className: 'dr-gf-menu', role: 'menu' },
          h('div', { className: 'dr-gf-options' }, [ALL, UNGROUPED, ...groups].map(option)),
          h('div', { className: 'dr-gf-footer' },
            h('button', { type: 'button', onClick: () => {
              setOpen(false)
              const name = askGroupName()
              if (name) libraryWork(app, app.rpc('group-create', { name }).then(() => onChange(name)))
            } }, '＋ 创建分组'),
            h('button', { type: 'button', onClick: () => { setOpen(false); onManage() } }, '管理分组'))) : null)
    }

    /** 管理分组 dialog: each group's 工作台性格, rename or delete it, add one, or go sort books in bulk. */
    function GroupManager({ app, groups, onClose, onBatch }) {
      const personas = usePersonas(app)
      return createPortal(h('div', { className: 'dr-overlay dr-overlay-top', onPointerDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { className: 'dr-dialog dr-gm', role: 'dialog', 'aria-label': '管理分组' },
          h('div', { className: 'dr-dialog-head' }, h('h3', null, '管理分组'), h('button', { type: 'button', className: 'dr-btn', onClick: onClose }, '关闭')),
          h('p', { className: 'dr-note' }, '每个分组可以绑定自己的工作台性格，组里的书读起来就用它；不绑定就跟随默认性格。'),
          groups.length === 0 ? h('p', { className: 'dr-note' }, '还没有分组。') : groups.map((g) => h('div', { key: g, className: 'dr-gm-row' },
            h('span', null, g),
            h(GroupPersona, { app, group: g, personas }),
            h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => {
              const to = askGroupName(g)
              if (to && to !== g) libraryWork(app, app.rpc('group-rename', { from: g, to }))
            } }, '重命名'),
            h('button', { type: 'button', className: 'dr-btn dr-btn-line dr-danger', onClick: () => {
              if (window.confirm(`删除分组「${g}」？里面的书会变成未分组，书本身不动。`)) libraryWork(app, app.rpc('group-delete', { name: g }))
            } }, '删除'))),
          h('div', { className: 'dr-row' },
            h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => {
              const name = askGroupName()
              if (name) libraryWork(app, app.rpc('group-create', { name }))
            } }, '＋ 创建分组'),
            h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => { onClose(); onBatch() } }, '批量整理书籍')))), document.body)
    }

    /**
     * The book list with tavern's tools above it: 分组 filter, search, and 批量管理 (tick books, then
     * 移动到分组). `card(book)` draws one book; the list goes in a div of `listClass`, so a scrolling
     * list does not clip the 分组 menu above it.
     */
    function BookBrowser({ app, books, groups, card, listClass = 'dr-bb-list' }) {
      const [group, setGroup] = useState(ALL)
      const [query, setQuery] = useState('')
      const [managing, setManaging] = useState(false)
      const [batch, setBatch] = useState(null)
      // A group renamed or deleted elsewhere falls back to 全部.
      const shownGroup = group === ALL || group === UNGROUPED || groups.includes(group) ? group : ALL
      const q = query.trim().toLowerCase()
      const shown = books.filter((b) => (shownGroup === ALL || (b.group ?? UNGROUPED) === shownGroup) && (!q || b.title.toLowerCase().includes(q)))
      const toggle = (id) => setBatch((set) => {
        const next = new Set(set)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
      const allPicked = batch && shown.length > 0 && shown.every((b) => batch.has(b.id))
      function move(event) {
        let target = event.target.value
        event.target.value = ''
        if (!target || batch.size === 0) return
        if (target === '\u0000new') target = askGroupName()
        if (!target) return
        libraryWork(app, app.rpc('book-group', { bookIds: [...batch], group: target === UNGROUPED ? '' : target }).then(() => setBatch(new Set())))
      }
      return h(React.Fragment, null,
        h('div', { className: 'dr-bb-tools' },
          h(GroupFilter, { app, books, groups, value: shownGroup, onChange: setGroup, onManage: () => setManaging(true) }),
          h('input', { className: 'dr-bb-search', type: 'search', placeholder: '搜索书名', value: query, onChange: (e) => setQuery(e.target.value) }),
          batch ? null : h('button', { type: 'button', className: 'dr-btn dr-btn-line', onClick: () => setBatch(new Set()) }, '批量管理')),
        batch ? h('div', { className: 'dr-bb-batch' },
          h('label', null, h('input', { type: 'checkbox', checked: allPicked, onChange: () => setBatch(allPicked ? new Set() : new Set(shown.map((b) => b.id))) }), '全选'),
          h('span', { className: 'dr-note' }, batch.size ? `已选 ${batch.size} 本` : '点书选择'),
          h('select', { value: '', disabled: batch.size === 0, onChange: move },
            h('option', { value: '' }, '移动到分组…'),
            groups.map((g) => h('option', { key: g, value: g }, g)),
            h('option', { value: UNGROUPED }, '未分组'),
            h('option', { value: '\u0000new' }, '新建分组…')),
          h('button', { type: 'button', className: 'dr-btn', onClick: () => setBatch(null) }, '完成')) : null,
        h('div', { className: listClass }, shown.length === 0 ? h('p', { className: 'dr-note' }, q ? '没有书名匹配的书。' : '这个分组里还没有书。')
          : shown.map((b) => batch
            ? h('label', { key: b.id, className: 'dr-card dr-card-pick' },
              h('input', { type: 'checkbox', checked: batch.has(b.id), onChange: () => toggle(b.id) }),
              h('div', { className: 'dr-card-text' },
                h('div', { className: 'dr-card-title' }, b.title),
                h('div', { className: 'dr-card-meta' }, `${b.group ?? '未分组'} · ${b.chars.toLocaleString()} 字 · ${b.chapters} 节`)))
            : card(b))),
        managing ? h(GroupManager, { app, groups, onClose: () => setManaging(false), onBatch: () => setBatch(new Set()) }) : null)
    }

    /**
     * A small chip that opens a menu like the 分组 filter's: `options` [{ value, label }] with ✓ on
     * `value`, then `footer` actions [{ label, run }] under a line.
     */
    function ChipMenu({ icon, label, title, options, value, onPick, footer = [], className = '' }) {
      const ref = useRef(null)
      const [open, setOpen] = useDropdown(ref)
      return h('div', { ref, className: 'dr-gf dr-chip-menu ' + className },
        h('button', { type: 'button', className: 'dr-chip', 'aria-expanded': open, title, onClick: () => setOpen(!open) },
          icon ? h(Icon, { name: icon, size: 13 }) : null, h('span', null, label), h(Icon, { name: open ? 'up' : 'down', size: 12 })),
        open ? h('div', { className: 'dr-gf-menu', role: 'menu' },
          h('div', { className: 'dr-gf-options' }, options.map((o) => o.heading
            ? h('div', { key: o.heading, className: 'dr-gf-heading' }, o.heading)
            : h('button', { key: o.value, type: 'button', 'aria-pressed': value === o.value, onClick: () => { setOpen(false); if (o.value !== value) onPick(o.value) } },
              o.label, h('span', null, value === o.value ? '✓' : '')))),
          footer.length ? h('div', { className: 'dr-gf-footer' }, footer.map((f) => h('button', { key: f.label, type: 'button', onClick: () => { setOpen(false); f.run() } }, f.label))) : null) : null)
    }

    /** 分组 chip on a book's page: 未分组, each group, 新建分组. */
    function GroupSelect({ app, book, groups }) {
      const move = (group) => libraryWork(app, app.rpc('book-group', { bookId: book.id, group }))
      return h(ChipMenu, {
        className: 'dr-bd-group', icon: 'folder', label: book.group || '未分组', title: '书库分组', value: book.group ?? '',
        options: [{ value: '', label: '未分组' }, ...groups.map((g) => ({ value: g, label: g }))],
        onPick: move,
        footer: [{ label: '＋ 新建分组', run: () => { const name = askGroupName(); if (name) move(name) } }],
      })
    }

    const FOLLOW_DEFAULT = '\u0000default'

    /** 性格 chip on a 管理分组 row: follow the default, blank, or a persona of the group's own. */
    function GroupPersona({ app, group, personas }) {
      if (!personas) return null
      const bound = personas.groups[group]
      const value = bound === undefined ? FOLLOW_DEFAULT : bound
      const name = (id) => id === '' ? '空白' : personas.items.find((item) => item.id === id)?.name
      const options = [
        { value: FOLLOW_DEFAULT, label: `跟随默认（${name(personas.activeId) ?? '空白'}）` },
        { value: '', label: '空白（不带性格）' },
        { heading: '内置' }, ...personas.items.filter((item) => item.builtin).map((item) => ({ value: item.id, label: item.name })),
        ...(personas.items.some((item) => !item.builtin) ? [{ heading: '我的' }, ...personas.items.filter((item) => !item.builtin).map((item) => ({ value: item.id, label: item.name }))] : []),
      ]
      return h(ChipMenu, {
        icon: 'persona', title: '这个分组的书用哪个工作台性格', value,
        label: value === FOLLOW_DEFAULT ? '跟随默认' : name(value) ?? '跟随默认',
        options,
        onPick: (id) => app.rpc('persona', { action: 'bind', group, id: id === FOLLOW_DEFAULT ? null : id })
          .then(() => app.personasChanged.bump(), (e) => window.alert(String(e?.message ?? e))),
      })
    }

    /**
     * 选择一本书 · 开始阅读: dialog over the whole frame, like tavern's card picker. Importing and the
     * 书库 page are reached from here, as tavern reaches its card tools from the picker.
     */
    function BookPicker({ app, onClose, onLibrary }) {
      const { books, groups, error } = useLibrary(app)
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
            h('button', { type: 'button', className: 'dr-btn dr-btn-line', title: '在右栏打开书库：分组、详情、总结', onClick: () => { onLibrary(); onClose() } }, '管理书库'),
            h('button', { type: 'button', className: 'dr-btn', onClick: onClose }, '关闭')),
          h('p', { className: 'dr-note' }, '每本书开一个新对话；Agent 以当前的工作台性格陪你读。'),
          failure ? h('p', { className: 'dr-error' }, failure) : null,
          error ? h('p', { className: 'dr-error' }, error)
            : books === null ? h('p', { className: 'dr-note' }, '读取中…')
              : books.length === 0 ? h('p', { className: 'dr-note' }, '书库是空的，先导入一本 TXT、EPUB 或 PDF。')
                : h(BookBrowser, { app, books, groups, listClass: 'dr-dialog-list', card: (b) => h('div', { key: b.id, className: 'dr-card' },
                    h('div', { className: 'dr-card-text' },
                      h('div', { className: 'dr-card-title' }, b.title),
                      h('div', { className: 'dr-card-meta' }, `${b.chars.toLocaleString()} 字 · ${b.chapters} 节`)),
                    h('button', { type: 'button', className: 'dr-btn dr-btn-line', disabled: starting !== null, onClick: () => start(b.id) },
                      starting === b.id ? '正在打开…' : '开始阅读')) }))), document.body)
    }

    /** Small line icons (16px, currentColor) for the sidebar. */
    const ICONS = {
      book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H12v12H5.5A1.5 1.5 0 0 0 4 16.5zM4 16.5A1.5 1.5 0 0 0 5.5 18H16V6M12 3h4v3',
      plus: 'M10 4v12M4 10h12',
      list: 'M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01',
      left: 'M12.5 4.5 7 10l5.5 5.5',
      right: 'M7.5 4.5 13 10l-5.5 5.5',
      close: 'M5 5l10 10M15 5 5 15',
      note: 'M5 3.5h7l3 3v10H5zM8 9.5h4M8 12.5h4',
      locate: 'M10 3v3M10 14v3M3 10h3M14 10h3M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
      persona: 'M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c.6-3.2 3-5 6-5s5.4 1.8 6 5',
      folder: 'M3 6V5a1.5 1.5 0 0 1 1.5-1.5H8l2 2h5.5A1.5 1.5 0 0 1 17 7v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z',
      pen: 'M3.5 17h13M6 13.5l7.5-7.5 2 2-7.5 7.5H6z',
      copy: 'M7.5 7.5h8.5v8.5H7.5zM4.5 12.5v-8h8',
      chat: 'M4 4.5h12v8.5H9.5L6 16v-3H4z',
      up: 'M5 12.5 10 7.5l5 5',
      down: 'M5 7.5 10 12.5l5-5',
      panel: 'M3.5 4.5h13v11h-13zM12.5 4.5v11',
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
      // The persona the open book reads with: its group's own, else the default.
      const openBook = books?.find((b) => b.id === app.store.get(current)?.bookId)
      const bound = openBook?.group ? persona?.groups[openBook.group] : undefined
      const fromGroup = bound !== undefined && (bound === '' || persona?.items.some((item) => item.id === bound))
      const activePersona = persona?.items.find((item) => item.id === (fromGroup ? bound : persona.activeId))

      const total = ordered.reduce((n, group) => n + group.items.length, 0)

      return h('div', { className: 'dr-side' },
        h('div', { className: 'dr-side-head' },
          h('span', { className: 'dr-side-mark' }, h(Icon, { name: 'book', size: 17 })),
          h('span', { className: 'dr-side-name' }, h('b', null, 'DSH 阅读器'), h('span', null, '书在中间 · 陪读在右边'))),
        h('button', { type: 'button', className: 'dr-side-new', onClick: () => setPicking(true) }, '＋ 选择一本书 · 开始阅读'),
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
        h('div', { className: 'dr-persona-row', onClick: () => app.openPersona(current), title: fromGroup ? `这本书在「${openBook.group}」分组，用分组绑定的性格；在书库「管理分组」里改` : '切换默认工作台性格' },
          h('span', null, '工作台性格'), h('b', null, activePersona?.name ?? '空白'), fromGroup ? h('small', null, openBook.group) : null),
        picking ? h(BookPicker, { app, onClose: () => setPicking(false), onLibrary: () => app.openLibrary(current) }) : null)
    }

    /** Persona library view, refreshed whenever it changes anywhere. */
    function usePersonas(app) {
      const version = useSignal(app.personasChanged)
      const [view, setView] = useState(null)
      useEffect(() => { app.rpc('personas').then(setView) }, [version])
      return view
    }

    /** Right Sidebar 工作台性格 page: pick a built-in, one of the user's own or blank; edit, add, rename, delete. */
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
          h('p', null, '这里选的是默认性格。分组可以在书库「管理分组」里绑定自己的性格，组里的书就用它。改动从下一次请求开始生效。'))),
        h('select', {
          value: view.activeId, disabled: busy,
          onChange: (e) => manage({ action: 'select', id: e.target.value }, e.target.value ? '已切换性格。' : '已切换为空白。'),
        }, h('option', { value: '' }, '空白（不带性格）'),
          h('optgroup', { label: '内置' }, view.items.filter((item) => item.builtin).map((item) => h('option', { key: item.id, value: item.id }, item.name + (item.modified ? '（已修改）' : '')))),
          view.items.some((item) => !item.builtin) ? h('optgroup', { label: '我的' }, view.items.filter((item) => !item.builtin).map((item) => h('option', { key: item.id, value: item.id }, item.name))) : null),
        h('button', { type: 'button', className: 'dr-btn dr-btn-line', disabled: busy, style: { alignSelf: 'flex-start' }, onClick: () => {
          const name = window.prompt('新性格的名字（比如：命理老师、讲经法师）')?.trim()
          if (name) manage({ action: 'create', name }, `已新建「${name}」并切换过去。写好性格内容后点保存。`)
        } }, '＋ 新建性格'),
        active === null ? h('p', { className: 'dr-note' }, '当前为空白：Agent 不带自定义性格。')
          : h(React.Fragment, null,
            h('textarea', { value: text, disabled: busy, 'aria-label': '性格内容', onChange: (e) => { setDraft(e.target.value); setNotice('') } }),
            h('div', { className: 'dr-persona-actions' },
              active.builtin
                ? h('button', { type: 'button', className: 'dr-btn dr-btn-line', disabled: busy || !active.modified, onClick: () => window.confirm(`把「${active.name}」恢复为内置的默认内容？你的修改会丢失。`) && manage({ action: 'restore', id: active.id }, '已恢复默认内容。') }, '恢复默认')
                : h(React.Fragment, null,
                  h('button', { type: 'button', className: 'dr-btn dr-btn-line dr-danger', disabled: busy, onClick: () => window.confirm(`删除性格「${active.name}」？删除后不能恢复。`) && manage({ action: 'delete', id: active.id }, '已删除，当前为空白。') }, '删除'),
                  h('button', { type: 'button', className: 'dr-btn dr-btn-line', disabled: busy, onClick: () => {
                    const name = window.prompt('新的名字', active.name)?.trim()
                    if (name && name !== active.name) manage({ action: 'rename', id: active.id, name }, '已重命名。')
                  } }, '重命名')),
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

    /** 127.5 万字 for long books; the exact count under ten thousand. */
    const formatChars = (chars) => chars >= 10000 ? `${(chars / 10000).toFixed(1).replace(/\.0$/, '')} 万字` : `${chars} 字`

    /**
     * A book's page in 书库: its numbers and three tabs — 高亮 (every highlight), 笔记 (highlights the
     * user wrote a note on) and 总结 (the agent's summaries).
     */
    function BookDetail({ app, book, groups, sessionId, binding, onBack, here, fresh }) {
      const [summaries, setSummaries] = useState(null)
      const [marks, setMarks] = useState(null)
      const [toc, setToc] = useState(null)
      const [tab, setTab] = useState('marks')
      const [open, setOpen] = useState(() => new Set())
      useEffect(() => { app.rpc('summaries', { bookId: book.id }).then(setSummaries, () => setSummaries([])) }, [book.id])
      // Notes written in the reader, and the agent's highlights (binding.marks), show up without reopening.
      const marksVersion = useSignal(app.marksChanged)
      useEffect(() => { app.rpc('highlights', { bookId: book.id }).then(setMarks, () => setMarks({ highlights: [], notes: [] })) }, [book.id, marksVersion, binding?.marks])
      useEffect(() => { app.rpc('toc', { bookId: book.id }).then(setToc, () => {}) }, [book.id])
      const reading = binding?.bookId === book.id
      const rows = toc ? tocRows(toc.chapters) : []
      const chapterLabel = (index, title) => `第 ${index + 1} 节 · ${rows[index]?.name ?? tocRows([{ title }])[0].name}`
      const highlights = marks?.highlights ?? null
      // 笔记 = notes about the whole book + notes on highlights.
      const notes = highlights?.filter((m) => m.note) ?? null
      const bookNotes = marks?.notes ?? []
      const changed = (work) => work.then(() => app.marksChanged.bump(), (e) => window.alert(String(e?.message ?? e)))
      const saveNote = (id, note) => changed(app.rpc('book-note-save', { bookId: book.id, id, note, chapter: reading ? binding.chapter ?? 0 : null }))
      const removeNote = (id) => changed(app.rpc('book-note-remove', { bookId: book.id, id }))
      const toggle = (index) => setOpen((set) => {
        const next = new Set(set)
        next.has(index) ? next.delete(index) : next.add(index)
        return next
      })
      const allOpen = summaries?.length > 0 && summaries.every((s) => open.has(s.index))
      // Same anchor show_passage sets, so the reader highlights the line and scrolls to it.
      const locate = (m) => app.store.bind(sessionId, { chapter: m.chapter, anchor: { quote: m.quote, at: m.at, prefix: m.prefix, suffix: m.suffix, nonce: Date.now() } })
      const locateButton = (m) => reading ? h('button', { type: 'button', className: 'dr-bd-locate', title: '在阅读区定位', 'aria-label': '在阅读区定位', onClick: () => locate(m) }, h(Icon, { name: 'locate', size: 15 })) : null
      const progress = reading ? Math.round(((binding.chapter ?? 0) + 1) / book.chapters * 100) : 0
      // Items grouped under their chapter, in reading order.
      const grouped = (list, item) => list.flatMap((m, i) => [
        m.chapter === list[i - 1]?.chapter ? null : h('div', { key: `c${m.chapter}`, className: 'dr-bd-chapter' }, chapterLabel(m.chapter, m.title)),
        item(m),
      ])
      const empty = (text) => h('p', { className: 'dr-bd-empty' }, text)
      const tabs = [
        ['marks', '高亮', highlights?.length],
        ['notes', '笔记', notes ? notes.length + bookNotes.length : 0],
        ['sums', '总结', summaries?.length],
      ]
      return h('div', { className: 'dr-lib dr-bd' },
        h('button', { type: 'button', className: 'dr-back', onClick: onBack }, h(Icon, { name: 'left', size: 14 }), '书库'),
        h('header', { className: 'dr-bd-head' },
          h('h3', null, book.title),
          h('p', null, `${formatChars(book.chars)} · ${book.chapters} 节`),
          h(GroupSelect, { app, book, groups }),
          reading ? h('div', { className: 'dr-bd-progress' },
            h('div', null, h('span', null, `读到第 ${(binding.chapter ?? 0) + 1} 节`), h('span', null, `${progress}%`)),
            h('i', null, h('b', { style: { width: `${progress}%` } }))) : null,
          reading ? null : h('div', { className: 'dr-bd-actions' },
            h('button', { type: 'button', className: 'dr-btn', onClick: () => (binding?.bookId ? fresh(book.id) : here(book.id)) }, binding?.bookId ? '新开阅读' : '打开阅读'))),
        h('div', { className: 'dr-bd-tabs', role: 'tablist' }, tabs.map(([id, label, n]) =>
          h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, onClick: () => setTab(id) }, label, n ? h('em', null, n) : null))),
        tab === 'marks' ? (highlights === null ? empty('读取中…')
          : highlights.length === 0 ? empty('还没有高亮。读书时选中文字就能划线，也可以让 Agent「把这段标一下」。')
            : h('div', { className: 'dr-bd-list' }, grouped(highlights, (m) => h('div', { key: m.id, className: 'dr-bd-mark' + (m.by === 'agent' ? ' dr-bd-agent' : '') },
              h('blockquote', null, plainQuote(m.quote)),
              m.note ? h('p', { className: 'dr-bd-mark-note' }, h(Icon, { name: 'note', size: 13 }), m.note) : null,
              h('div', { className: 'dr-bd-foot' }, m.by === 'agent' ? h('span', null, 'Agent 划的') : null, locateButton(m))))))
          : null,
        tab === 'notes' ? (notes === null ? empty('读取中…')
          : h('div', { className: 'dr-bd-list' },
            h('div', { className: 'dr-bd-chapter' }, '随想'),
            h(BookNotes, { notes: bookNotes, chapter: reading ? binding.chapter ?? 0 : null, save: saveNote, remove: removeNote }),
            notes.length === 0 ? empty('原文上还没有笔记。在阅读区选中文字点「写想法」，或者点开一条高亮写下想法。')
              : grouped(notes, (m) => h('div', { key: m.id, className: 'dr-bd-note' },
              h('p', null, m.note),
              h('blockquote', null, plainQuote(m.quote)),
              h('div', { className: 'dr-bd-foot' }, locateButton(m))))))
          : null,
        tab === 'sums' ? h(React.Fragment, null,
          h('div', { className: 'dr-bd-tools' },
            summaries?.length ? h('button', { type: 'button', className: 'dr-bd-tool', onClick: () => setOpen(allOpen ? new Set() : new Set(summaries.map((s) => s.index))) }, h(Icon, { name: allOpen ? 'up' : 'down', size: 14 }), allOpen ? '全部收起' : '全部展开') : null,
            h('button', { type: 'button', className: 'dr-bd-tool', title: '在 Finder 中打开总结文件夹，方便手改', onClick: () => app.rpc('reveal', { bookId: book.id, sub: '总结' }) }, h(Icon, { name: 'folder', size: 14 }), '总结文件夹')),
          summaries === null ? empty('读取中…')
            : summaries.length === 0 ? empty('还没有总结。在对话里让 Agent「把这一节总结一下」或「把前十节都总结了」，写好的总结会出现在这里。')
              : h('div', { className: 'dr-bd-sums' }, summaries.map((s) => h('div', { key: s.index, className: 'dr-bd-sum' + (open.has(s.index) ? ' dr-bd-sum-open' : '') },
                h('button', { type: 'button', className: 'dr-bd-sum-head', 'aria-expanded': open.has(s.index), onClick: () => toggle(s.index) },
                  h('span', { className: 'dr-bd-n' }, s.index + 1),
                  h('span', { className: 'dr-bd-sum-title' }, rows[s.index]?.name ?? tocRows([s])[0].name),
                  h(Icon, { name: open.has(s.index) ? 'up' : 'down', size: 14 })),
                open.has(s.index) ? h('div', { className: 'dr-bd-sum-body' },
                  h(Markdown, { text: s.text.replace(/^#\s+[^\n]*\n+/, '') }),
                  reading ? h('button', { type: 'button', className: 'dr-bd-tool', onClick: () => app.store.bind(sessionId, { chapter: s.index }) }, h(Icon, { name: 'locate', size: 14 }), '在阅读区打开这一节') : null) : null))))
          : null)
    }

    /** Right Sidebar 书库 page: one card per book, like tavern's 人物卡库; a card opens the book's page, where reading starts. */
    function LibraryTab({ sessionId, app }) {
      const { books, groups, error } = useLibrary(app)
      const binding = useBinding(app.store, sessionId)
      const [failure, setFailure] = useState(null)
      const [detail, setDetail] = useState(null)
      const current = binding?.bookId
      // Switching keeps each book's place (the host remembers positions per book); 新开 starts a separate session.
      const run = (work) => work.catch((e) => setFailure(String(e?.message ?? e)))
      const here = (bookId) => run(app.store.bind(sessionId, { bookId }))
      const fresh = (bookId) => run(app.startReading(bookId))
      const shown = detail && books?.find((b) => b.id === detail)
      if (shown) return h(BookDetail, { app, book: shown, groups, sessionId, binding, onBack: () => setDetail(null), here, fresh })
      return h('div', { className: 'dr-lib' },
        h('div', { className: 'dr-lib-head' },
          h('div', null,
            h('h3', null, '书库'),
            h('p', null, '导入 TXT、EPUB 或 PDF，或直接放进 dsh-reader/library/ 目录。点书名看详情、总结，在那里分组。')),
          h(ImportButton, { app, className: 'dr-btn dr-btn-line', label: '导入' })),
        failure ? h('p', { className: 'dr-error' }, failure) : null,
        error ? h('p', { className: 'dr-error' }, error)
          : books === null ? h('p', { className: 'dr-note' }, '读取中…')
            : books.length === 0 ? h('p', { className: 'dr-note' }, '书库是空的。')
              : h(BookBrowser, { app, books, groups, card: (b) => h('div', { key: b.id, className: 'dr-card' + (b.id === current ? ' dr-card-on' : '') },
                h('button', { type: 'button', className: 'dr-card-text dr-card-link', title: '看详情和总结', onClick: () => setDetail(b.id) },
                  h('div', { className: 'dr-card-title' }, (b.id === current ? '✓ ' : '') + b.title),
                  h('div', { className: 'dr-card-meta' }, `${b.chars.toLocaleString()} 字 · ${b.chapters} 节`
                    + (b.id === current ? ` · 读到第 ${(binding.chapter ?? 0) + 1} 节` : ''))),
                b.id === current ? h('span', { className: 'dr-note' }, '在读') : null) }))
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

    /** Edits a note: on a quote (a new or existing highlight), or about the whole book (`context` instead). */
    function NoteEditor({ quote, title, context, initial, placeholder = '写下你的想法…', onSave, onCancel, extra }) {
      const [value, setValue] = useState(initial ?? '')
      // An empty new note has nothing to save; emptying an existing one clears it.
      const blank = !value.trim() && !initial
      const save = () => { if (!blank) onSave(value) }
      return h(React.Fragment, null,
        title || context ? h('div', { className: 'dr-pop-head' },
          title ? h('b', null, h(Icon, { name: 'note', size: 14 }), title) : null,
          context ? h('span', null, context) : null) : null,
        quote ? h('blockquote', { className: 'dr-pop-quote' }, plainQuote(quote)) : null,
        h('textarea', {
          className: 'dr-pop-text', rows: 4, autoFocus: true, placeholder, value,
          onChange: (e) => setValue(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') onCancel() },
        }),
        extra ? h('div', { className: 'dr-pop-row' }, extra) : null,
        h('div', { className: 'dr-pop-row' },
          h('span', { className: 'dr-pop-hint' }, '⌘↩ 保存'),
          h('span', { className: 'dr-grow' }),
          h('button', { type: 'button', className: 'dr-pop-cancel', onClick: onCancel }, '取消'),
          h('button', { type: 'button', className: 'dr-pop-save', disabled: blank, onClick: save }, '保存')))
    }


    const CHAPTER_PREFIX = /^第[0-9零一二三四五六七八九十百千万两〇]+[章回节][\s:：、.．·]*/
    const PART_ONLY = /^（[0-9一二三四五六七八九十]+）$/
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
        const name = full.replace(CHAPTER_PREFIX, '').trim()
        // 「第一章（一）」 split parts: 「（一）」 alone says nothing, so keep the chapter.
        return { ...chapter, index, volume, full, name: !name || PART_ONLY.test(name) ? full : name }
      })
    }

    /** 目录: slides over the left of the reader, like an e-reader's contents panel. */
    function TocDrawer({ rpc, bookId, index, agentIndex, highlights, notes, saveNote, removeNote, onPick, onLocate, onClose }) {
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
              h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'notes', onClick: () => setTab('notes') }, `笔记${highlights.length + notes.length ? ` ${highlights.length + notes.length}` : ''}`)),
            h('span', null, tab === 'toc' ? `${total} 节${done ? ` · ${done} 节有总结` : ''}` : `${highlights.length} 条划线 · ${notes.length + highlights.filter((m) => m.note).length} 条笔记`),
            h('button', { type: 'button', className: 'dr-nav', 'aria-label': '关闭目录', onClick: onClose }, h(Icon, { name: 'close' }))),
          h('input', { className: 'dr-toc-search', placeholder: tab === 'toc' ? '搜章名或序号' : '搜划线或想法', value: query, autoFocus: !NARROW.matches, onChange: (e) => setQuery(e.target.value) }),
          tab === 'notes' ? h(NotesList, { rows, highlights, notes, chapter: index, query: q, saveNote, removeNote, onLocate: (m) => { onLocate(m); onClose() } }) : h(React.Fragment, null,
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

    /**
     * A writing sheet for notes about the whole book: centred over the window, wide and tall, in the
     * reading font, because these notes are thoughts and want room, not a popover.
     */
    function NoteSheet({ title, context, initial = '', placeholder, onSave, onClose }) {
      const t = useTypography()
      const [value, setValue] = useState(initial)
      const text = useRef(null)
      const blank = !value.trim()
      const dirty = value !== initial
      const close = () => { if (!dirty || window.confirm('还没保存，确定不要了？')) onClose() }
      const save = () => { if (!blank) onSave(value) }
      // Grow with the text up to the sheet's height, so long thoughts are not read through a slot.
      useEffect(() => {
        const el = text.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }, [value])
      useEffect(() => {
        const el = text.current
        el?.focus()
        el?.setSelectionRange(el.value.length, el.value.length)
      }, [])
      return createPortal(h('div', { className: 'dr-overlay dr-sheet-overlay', onPointerDown: (e) => { if (e.target === e.currentTarget) close() } },
        h('div', { className: 'dr-sheet', role: 'dialog', 'aria-label': title },
          h('div', { className: 'dr-sheet-head' },
            h('b', null, h(Icon, { name: 'note', size: 17 }), title),
            context ? h('span', null, context) : null),
          h('textarea', {
            ref: text, className: 'dr-sheet-text', placeholder, value,
            style: { fontFamily: (FONTS[t.font] ?? FONTS.song).stack },
            onChange: (e) => setValue(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') { e.stopPropagation(); close() } },
          }),
          h('div', { className: 'dr-sheet-foot' },
            h('span', null, `${value.replace(/\s/g, '').length} 字 · ⌘↩ 保存 · Esc 关闭`),
            h('span', { className: 'dr-grow' }),
            h('button', { type: 'button', className: 'dr-pop-cancel', onClick: close }, '取消'),
            h('button', { type: 'button', className: 'dr-pop-save', disabled: blank || !dirty, onClick: save }, '保存')))), document.body)
    }

    /** Where a whole-book note was written: 读到第 n 节 · 10/24 16:01. */
    const noteMeta = (n) => [n.chapter === null || n.chapter === undefined ? null : `读到第 ${n.chapter + 1} 节`, formatTime(Date.parse(n.createdAt))].filter(Boolean).join(' · ')

    /**
     * 随想, notes on no quote: 写随想, and each one with 修改 / 删除.
     * `chapter` is where the user is reading now, saved with a new note; null when not reading this book.
     */
    function BookNotes({ notes, chapter, save, remove }) {
      const [editing, setEditing] = useState(null) // 'new' or a note id
      const editingNote = notes.find((n) => n.id === editing)
      return h('div', { className: 'dr-booknotes' },
        h('button', { type: 'button', className: 'dr-booknote-add', onClick: () => setEditing('new') }, h(Icon, { name: 'plus', size: 14 }), '写随想'),
        editing === 'new' ? h(NoteSheet, {
          title: '随想', context: chapter === null ? null : `读到第 ${chapter + 1} 节`, placeholder: '这本书让你想到什么…',
          onClose: () => setEditing(null), onSave: (text) => { save(null, text); setEditing(null) },
        }) : null,
        editingNote ? h(NoteSheet, {
          key: editingNote.id, title: '修改随想', context: noteMeta(editingNote), initial: editingNote.note,
          onClose: () => setEditing(null), onSave: (text) => { save(editingNote.id, text); setEditing(null) },
        }) : null,
        notes.map((n) => h('div', { key: n.id, className: 'dr-booknote' },
            h('p', null, n.note),
            h('div', { className: 'dr-booknote-foot' },
              h('span', null, noteMeta(n)),
              h('button', { type: 'button', onClick: () => setEditing(n.id) }, '修改'),
              h('button', { type: 'button', onClick: () => { if (window.confirm('删除这条随想？')) remove(n.id) } }, '删除')))))
    }

    /** 笔记: notes about the whole book first, then every highlight in reading order, grouped by chapter. */
    function NotesList({ rows, highlights, notes, chapter, query, onLocate, saveNote, removeNote }) {
      const shown = query ? highlights.filter((m) => m.quote.includes(query) || m.note?.includes(query)) : highlights
      const loose = query ? notes.filter((n) => n.note.includes(query)) : notes
      return h('div', { className: 'dr-toc-list dr-notes' },
        h('div', { className: 'dr-toc-vol' }, '随想'),
        h(BookNotes, { notes: loose, chapter, save: saveNote, remove: removeNote }),
        highlights.length === 0 ? h('p', { className: 'dr-note dr-notes-empty' }, '还没有划线。选中正文里的文字，就能划线或写想法。')
          : shown.length === 0 ? h('p', { className: 'dr-note dr-notes-empty' }, '没有匹配的划线。')
            : shown.flatMap((m, i) => [
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

    function Reader({ rpc, binding, marksChanged, onMove, onLocate, onAsk, onShowChat }) {
      const t = useTypography()
      const [panel, setPanel] = useState(false)
      const [drawer, setDrawer] = useState(false)
      const [toc, setToc] = useState(null)
      const [chapter, setChapter] = useState(null)
      const [marks, setMarks] = useState({ highlights: [], notes: [] })
      const { highlights, notes } = marks
      const marksVersion = useSignal(marksChanged)
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
      useEffect(() => { rpc('highlights', { bookId }).then(setMarks, () => setMarks({ highlights: [], notes: [] })) }, [bookId, binding.marks, marksVersion])
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

      const changed = () => marksChanged.bump()
      const run = (work) => work.then(changed).catch((e) => setFailure(String(e?.message ?? e)))
      const clearSelection = () => { document.getSelection()?.removeAllRanges(); setSelection(null) }
      const mark = (span, note = '') => run(rpc('highlight-add', { bookId, chapter: index, at: span.at, end: span.end, note }).then(clearSelection))
      const copy = (quote) => {
        navigator.clipboard?.writeText(plainQuote(quote)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }, () => setFailure('复制失败'))
      }
      const ask = (quote) => { onAsk(plainQuote(quote)); clearSelection(); setCard(null) }
      const saveNote = (id, note) => run(rpc('book-note-save', { bookId, id, note, chapter: index }))
      const removeNote = (id) => run(rpc('book-note-remove', { bookId, id }))
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
          h('button', { type: 'button', className: 'dr-nav', title: '写随想', 'aria-label': '写随想', onClick: () => setCard({ kind: 'book' }) }, h(Icon, { name: 'note' })),
          h('button', { type: 'button', className: 'dr-btn', title: '阅读设置', 'aria-label': '阅读设置', 'aria-expanded': panel, onClick: () => setPanel((open) => !open), style: { fontFamily: FONTS.song.stack, fontWeight: 600 } }, 'Aa'),
          h('button', { type: 'button', className: 'dr-btn dr-btn-icon', title: '展开右侧栏：和 Agent 对话', onClick: onShowChat }, h(Icon, { name: 'panel', size: 15 }), '对话')),
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
        card && card.kind !== 'book' ? h('div', { className: 'dr-pop-scrim', onMouseDown: () => setCard(null) }) : null,
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
        card?.kind === 'book' ? h(NoteSheet, {
          title: '随想', context: `《${toc?.title ?? ''}》 · 读到第 ${index + 1} 节`, placeholder: '这本书让你想到什么…',
          onClose: () => setCard(null),
          onSave: (note) => { saveNote(null, note); setCard(null) },
        }) : null,
        failure ? h('div', { className: 'dr-toast', role: 'alert', onClick: () => setFailure(null) }, failure) : null,
        drawer ? h(TocDrawer, { rpc, bookId, index, agentIndex, highlights, notes, saveNote, removeNote, onPick: onMove, onLocate, onClose: () => setDrawer(false) }) : null,
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
        marksChanged: app.marksChanged,
        onShowChat: app.openChat,
      })
    }

    /** Sent as is by the dock's quick button: the request typed most often while reading. */
    const NEXT_SUMMARY_PROMPT = '继续总结下一章，说人话'

    /**
     * Above the composer, like tavern's 生成候选项: send 继续总结下一章 in one click, and jump the
     * reader to the chapter the agent last read.
     */
    function AgentDock({ app, sessionId }) {
      const binding = useBinding(app.store, sessionId)
      if (!binding?.bookId) return null
      const agentIndex = binding.agentPositions?.[binding.bookId]
      const here = agentIndex === (binding.chapter ?? 0)
      // On a phone this dock sits in the fullscreen right column, over the reader: offer the way back.
      const phone = NARROW.matches
      return h('div', { className: 'dr-dock' },
        phone ? h('button', { type: 'button', className: 'dr-dock-btn', title: '收起右侧栏，回到阅读区', onClick: app.showReader }, '回到阅读') : null,
        h('button', {
          type: 'button', className: 'dr-dock-btn', title: `发送「${NEXT_SUMMARY_PROMPT}」`,
          onClick: () => app.sendPrompt(sessionId, NEXT_SUMMARY_PROMPT),
        }, '继续总结下一章'),
        agentIndex === undefined ? null : h('button', {
          type: 'button', className: 'dr-dock-btn', disabled: here,
          title: here ? '你和 Agent 在读同一节' : '阅读区跳到 Agent 最近读的那一节',
          onClick: () => { app.store.bind(sessionId, { chapter: agentIndex }); if (phone) app.showReader() },
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
          store: createBindingStore(rpc),
          libraryChanged: createSignal(),
          /** Any highlight or note changed from this page: the reader, its 笔记 tab and 书详情 all reload. */
          marksChanged: createSignal(),
          personasChanged: createSignal(),
          /**
           * Show the 对话 tab, expanding the column when it is collapsed: openTab only places the tab, and
           * DSH's own way back in is a button in the conversation header, which the reader replaces.
           * On a phone the column starts collapsed, so without this 对话 did nothing there.
           */
          openChat: () => {
            ctx.sidebarRight.openTab(CHAT_KIND)
            if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
          },
          /** Collapse the right column; on a phone it covers the reader, so this is the way back to reading. */
          showReader: () => { if (ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded() },
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
          /** Send a message as the user, queued behind a running reply; the composer's draft is left alone. */
          async sendPrompt(sessionId, text) {
            try {
              const result = await ctx.sessions.binding(sessionId).session.prompt([{ type: 'text', text }], 'queue')
              if (!result?.ok) throw new Error(result?.error?.message ?? '发送失败')
            } catch (error) {
              console.warn('dsh-reader: send prompt failed', error)
              window.alert(`没能发送：${error.message}`)
            }
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
          /** Upload a book, then follow the import job; `onProgress({ done, total })` while a scan is recognised. */
          async importFile(file, onProgress) {
            const res = await fetch(`${ROUTE}/import?name=${encodeURIComponent(file.name)}`, {
              method: 'POST', credentials: 'same-origin',
              headers: { 'content-type': 'application/octet-stream' }, body: file,
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
            for (;;) {
              const job = await rpc('import-status', { job: body.result.job })
              if (job.error) throw new Error(job.error)
              if (job.result) {
                app.libraryChanged.bump()
                return job.result
              }
              onProgress?.(job)
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
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
          name: 'conversation.input.dock', id: 'dsh-reader-agent-jump', order: -130, label: '继续总结、跳到 Agent 在读的章节',
        }, (props) => h(AgentDock, { app, sessionId: props.sessionId }))), 'dsh-reader: dock above composer')

        ctx.effect(() => ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT }, ChatConversation)),
          'dsh-reader: chat conversation')
      },
    }
  },
})
