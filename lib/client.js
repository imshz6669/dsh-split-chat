/**
 * Browser half of dsh-split-chat: open any Session as a chat tab in the right
 * sidebar while the main area keeps its own conversation.
 *
 * Hand-written bundle in the client-module protocol: executing the script only
 * registers a factory, and the module body runs at materialization.
 *
 * Mechanism (mirrors the shipped `@deepseek-ai/dsh-client-ui-subagent` sidebar
 * chat, generalised from "subagent child address" to "any session id"):
 *
 *   session row menu / row action
 *     -> ctx.sidebarRight.openResource('dsh-resource://splitchat/session/<id>',
 *                                      { kind: 'splitchat' })
 *     -> our `splitchat` resource provider
 *          -> ctx.sessions.retain(id, { source: 'splitChat', signal })
 *     -> `sidebar.right.pane.tab` seat (key = TAB_ID) in the right pane
 *          -> SessionProvider(reference) + `splitchat.conversation`
 *     -> renderFactorySlot('conversation.content', { variant: 'embedded', ... })
 *          -> the shared conversation body and composer, bound to that session
 *
 * @module dsh-split-chat/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-split-chat',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    // Baseline shared module (``PLATFORM_MODULES``). Guarded because a missing
    // primitive must degrade to a plain button, never fail the whole bundle.
    var primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (_missingPrimitives) {
      primitives = null
    }
    var MenuItemButton = primitives === null ? undefined : primitives.MenuItemButton

    /** Cordis plugin name / client module id: must equal the package name. */
    var NAME = 'dsh-split-chat'
    /** Locale dictionary namespace owned by this plugin. */
    var NS = 'splitChat'
    /** Right-sidebar tab kind registered by this plugin. */
    var KIND = 'splitchat'
    /** Identity shared by the tab type and the body/title slot cells. */
    var TAB_ID = 'dsh-split-chat'
    /** Resource protocol (the `dsh-resource://` URL host). */
    var PROTOCOL = 'splitchat'
    /** Canonical address prefix for an embedded Session chat. */
    var ADDRESS_PREFIX = 'dsh-resource://splitchat/session/'
    /** Session-scoped slot carrying the conversation inside the tab body. */
    var SLOT_CONVERSATION = 'splitchat.conversation'
    /** Ref source tag; the main view uses `mainView`, so keep ours distinct. */
    var RESOURCE_SOURCE = 'splitChat'

    /** Simplified Chinese dictionary (key-set source of truth). */
    var zh = {
      'open.aside': '在右侧打开',
      'open.aside.named': '在右侧打开「{title}」',
      'tab.title': '对话',
      'duplicate.title': '该会话已在主区打开',
      'duplicate.body': '主区和右侧栏不能同时编辑同一个会话。换一个会话在右侧打开，或把主区切到别的会话。',
      'open.failed.title': '无法打开该会话',
      'open.failed.body': '该会话可能已被归档或删除。关闭此标签即可。'
    }
    /** English dictionary, key-identical to the Chinese source of truth. */
    var en = {
      'open.aside': 'Open in sidebar',
      'open.aside.named': 'Open “{title}” in sidebar',
      'tab.title': 'Chat',
      'duplicate.title': 'This session is open in the main view',
      'duplicate.body': 'The main view and the sidebar cannot edit the same session. Open another session here, or switch the main view first.',
      'open.failed.title': 'This session could not be opened',
      'open.failed.body': 'It may have been archived or deleted. Close this tab to dismiss it.'
    }

    //#region address

    /**
     * Canonical resource address for one Session chat.
     *
     * @param sessionId - the Session to address.
     * @returns the `dsh-resource://splitchat/session/<id>` address.
     */
    function addressOf(sessionId) {
      return ADDRESS_PREFIX + encodeURIComponent(String(sessionId))
    }

    /**
     * Parse one canonical Session chat resource address.
     *
     * @param value - possible chat resource address.
     * @returns the encoded Session id, or undefined for another or malformed resource.
     */
    function parseAddress(value) {
      if (typeof value !== 'string' || value === '') return undefined
      var url
      try {
        url = new URL(value)
      } catch (_invalidUrl) {
        return undefined
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname !== PROTOCOL) return undefined
      var parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'session') return undefined
      var sessionId
      try {
        sessionId = decodeURIComponent(parts[1])
      } catch (_invalidEncoding) {
        return undefined
      }
      return sessionId === '' ? undefined : sessionId
    }

    /**
     * Settle when the resource stream's signal aborts.
     *
     * @param signal - the resource record's lifetime signal.
     * @returns a promise resolved on abort (or already resolved).
     */
    function waitAbort(signal) {
      if (signal.aborted) return Promise.resolve()
      return new Promise(function (resolve) {
        signal.addEventListener('abort', resolve, { once: true })
      })
    }
    //#endregion

    //#region resource provider

    /**
     * The `splitchat` resource provider: retain one Session for as long as a
     * record holds the address, and hand the reference to the tab body.
     *
     * @param sessions - the client Sessions service.
     * @returns the provider to register with `ctx.resources`.
     */
    function sessionChatResourceProvider(sessions) {
      return {
        protocol: PROTOCOL,
        async *open(resourceAddress, options) {
          var signal = options && options.signal !== undefined ? options.signal : new AbortController().signal
          var sessionId = parseAddress(resourceAddress)
          if (sessionId === undefined) throw new Error('dsh-split-chat: invalid resource address "' + resourceAddress + '"')
          if (signal.aborted) return
          var reference
          try {
            reference = sessions.retain(sessionId, { source: RESOURCE_SOURCE, signal: signal })
          } catch (error) {
            // A removed/archived session is a normal dead tab, not a bundle fault.
            yield { ok: false, error: error }
            return
          }
          try {
            yield { ok: true, value: { sessionId: sessionId, reference: reference } }
            await waitAbort(signal)
          } finally {
            reference.release()
          }
        }
      }
    }
    //#endregion

    //#region components

    /** Fixed Chat selection used by an embedded Conversation occurrence (same as ui-subagent). */
    function FixedChatView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    /**
     * The conversation inside the right-sidebar tab.
     *
     * Renders the shared Conversation content when this session is only shown
     * here, and the duplicate-open notice while the main view also retains it:
     * the Session editor is a single-root design, so two live mounts would fight.
     */
    function EmbeddedConversation(props) {
      var sessionId = props.sessionId
      var t = props.t
      var session = props.useSession(function (value) {
        return value
      })
      // Prefer the dedicated retention hook; the list row carries the same map
      // when the hook prop is absent on an older shell.
      var useSessionRetainInfo = props.useSessionRetainInfo
      var useSessions = props.useSessions
      var mainCount
      if (useSessionRetainInfo !== undefined) {
        mainCount = useSessionRetainInfo(function (info) {
          return info === undefined ? 0 : ((info.retainedBy && info.retainedBy.mainView) || 0)
        })
      } else {
        mainCount = useSessions(function (state) {
          var row = state.byId[sessionId]
          return row === undefined || row.retainedBy === undefined ? 0 : row.retainedBy.mainView || 0
        })
      }
      var activeTargets = props.useConversation(function (value) {
        return value.activeTargets
      })
      var summaryBlank = useSessions(function (state) {
        var row = state.byId[sessionId]
        return row === undefined ? undefined : row.blank
      })

      if (mainCount > 0) {
        return h(
          'div',
          { className: 'dsc-notice', role: 'status' },
          h('div', { className: 'dsc-notice-title' }, t('duplicate.title')),
          h('div', { className: 'dsc-notice-body' }, t('duplicate.body'))
        )
      }

      var shellPhase =
        activeTargets !== undefined && activeTargets.size > 0
          ? 'active'
          : (!session.blank && !session.awaitingFirstTurn) || session.running
            ? 'active'
            : session.promptAttempted
              ? 'engaging'
              : 'blank'
      var settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
      var hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
      return props.renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero: hero },
        { slots: { views: FixedChatView } }
      )
    }

    /**
     * One right-sidebar tab body: read the tab's resource and bind the Session
     * reference around our conversation slot.
     */
    function SidebarSessionTab(props) {
      var useResource = props.useResource
      var useTabInfo = props.useTabInfo
      var SessionProvider = props.SessionProvider
      var renderSlot = props.renderSlot
      var t = props.t
      // The tab record is committed before this seat dispatches; tolerate a
      // mid-teardown read without breaking the hook order.
      var tab
      try {
        tab = useTabInfo().tab
      } catch (_tabNotCommitted) {
        tab = undefined
      }
      var resource = useResource(tab === undefined ? '' : tab.contentId)
      var children = null
      if (resource !== undefined && resource.value !== undefined) {
        children = h(SessionProvider, { session: resource.value.reference }, renderSlot(SLOT_CONVERSATION, {}))
      } else if (resource !== undefined && resource.status === 'failed') {
        children = h(
          'div',
          { className: 'dsc-notice', role: 'status' },
          h('div', { className: 'dsc-notice-title' }, t('open.failed.title')),
          h('div', { className: 'dsc-notice-body' }, t('open.failed.body'))
        )
      }
      return h('div', { className: 'dsc-root', 'data-split-chat': '' }, children)
    }

    /**
     * The tab chip title: the live Session title, falling back to the generic
     * copy. The shell wraps the title seat in `display: contents`, so return
     * text only (inline content is all the chip expects).
     */
    function TabTitle(props) {
      var sessionId
      try {
        sessionId = parseAddress(props.useTabInfo().tab.contentId)
      } catch (_tabNotCommitted) {
        sessionId = undefined
      }
      var title = props.useSessions(function (state) {
        var row = sessionId === undefined ? undefined : state.byId[sessionId]
        return row === undefined ? undefined : row.title
      })
      return title === undefined || title === '' ? props.t('tab.title') : title
    }

    /**
     * The session row's "..." menu row: open this Session in the right sidebar.
     * `MenuItemButton` renders the styled `role="menuitem"` button itself; the
     * plain-button branch only runs when the baseline primitive is unavailable.
     */
    function MenuEntry(props) {
      var useMenuOpenState = props.useMenuOpenState
      var menuState = useMenuOpenState === undefined ? undefined : useMenuOpenState()
      var setMenuOpen = menuState === undefined ? undefined : menuState[1]
      var title = props.displayTitle
      var label =
        title === undefined || title === ''
          ? props.t('open.aside')
          : props.t('open.aside.named', { title: title })
      var select = function () {
        if (setMenuOpen !== undefined) setMenuOpen(false)
        props.openAside(props.sessionId)
      }
      if (MenuItemButton !== undefined) {
        return h(MenuItemButton, { onSelect: select }, label)
      }
      return h('button', { type: 'button', role: 'menuitem', className: 'dsc-menu-item', onClick: select }, label)
    }

    /** The session row's hover button: the same action as the menu row. */
    function RowAction(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsc-action',
          title: props.t('open.aside'),
          'aria-label': props.t('open.aside'),
          onClick: function () {
            props.openAside(props.sessionId)
          }
        },
        '\u29C9'
      )
    }
    //#endregion

    //#region css

    var CSS_ID = 'dsh-split-chat/client.css'
    var CSS =
      '.dsc-root{width:100%;min-width:0;height:100%;min-height:0;display:flex;flex-direction:column}' +
      '.dsc-notice{padding:24px 20px;display:flex;flex-direction:column;gap:8px;font-size:13px;' +
      'line-height:20px;color:var(--dsw-alias-label-secondary,#666);height:100%;box-sizing:border-box}' +
      '.dsc-notice-title{font-weight:600;color:var(--dsw-alias-label-primary,#111)}' +
      '.dsc-notice-body{max-width:44em}' +
      '.dsc-action{width:22px;height:22px;border:0;background:none;border-radius:6px;cursor:pointer;' +
      'color:var(--dsw-alias-label-tertiary,#999);padding:0;font-size:13px;line-height:22px;' +
      'display:inline-flex;align-items:center;justify-content:center;flex:none}' +
      '.dsc-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));' +
      'color:var(--dsw-alias-label-primary,#111)}' +
      '.dsc-menu-item{display:flex;align-items:center;width:100%;min-height:30px;border:0;' +
      'background:none;cursor:pointer;padding:0 10px;font:inherit;font-size:13px;' +
      'color:var(--dsw-alias-label-primary,#111);text-align:left;border-radius:6px}' +
      '.dsc-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}'

    /** Inject the stylesheet once; HMR remounts must not stack duplicates. */
    function injectCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_ID) + ']') !== null) return
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-split-chat'
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }
    //#endregion

    //#region plugin body

    /**
     * Client plugin body: inject copy and style, then contribute the resource
     * protocol, the tab type with its body and title, the embedded conversation,
     * and the two session-row entry points.
     *
     * @param ctx - the client Cordis context.
     */
    function apply(ctx) {
      injectCss()
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-split-chat: dictionaries')
      var t = ctx.locale.bind(NS)

      /**
       * Open one Session in the right sidebar; fall back to the main view when
       * no dock surface is mounted (the hero page has nothing to open into).
       *
       * @param sessionId - the Session the row stands for.
       */
      function openAside(sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return
        try {
          ctx.sidebarRight.openResource(addressOf(sessionId), { kind: KIND, preferNewPane: false })
        } catch (error) {
          console.error('dsh-split-chat: could not open the session in the right sidebar', error)
          try {
            ctx.uiWorkspace.openSession(sessionId)
          } catch (fallbackError) {
            console.error('dsh-split-chat: could not open the session in the main view', fallbackError)
          }
        }
      }

      var conversationChildren = {}
      conversationChildren[SLOT_CONVERSATION] = { kind: 'single', scope: 'session' }

      ctx.inject(['resources', 'sidebarRightTabs'], function (scope) {
        scope.effect(function () {
          return scope.resources.register(sessionChatResourceProvider(ctx.sessions))
        }, 'dsh-split-chat: resource provider')
        scope.effect(function () {
          return scope.sidebarRightTabs.register({
            id: TAB_ID,
            kind: KIND,
            patterns: [ADDRESS_PREFIX + '**'],
            priority: 'extension',
            canOpen: function (address) {
              return parseAddress(address) !== undefined
            },
            title: function (address) {
              var sessionId = parseAddress(address)
              if (sessionId === undefined) return t('tab.title')
              var row = ctx.sessions.list.getSnapshot().byId[sessionId]
              return row === undefined || row.title === undefined || row.title === '' ? t('tab.title') : row.title
            }
          })
        }, 'dsh-split-chat: tab type')
        scope.effect(function () {
          return scope.slots.inject('sidebar.right.pane.tab', function () {
            return scope.slots.register(
              { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, children: conversationChildren },
              SidebarSessionTab
            )
          })
        }, 'dsh-split-chat: tab body')
        scope.effect(function () {
          return scope.slots.inject('sidebar.right.pane.tab.title', function () {
            return scope.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS }, TabTitle)
          })
        }, 'dsh-split-chat: tab title')
        scope.effect(function () {
          return scope.slots.inject(SLOT_CONVERSATION, function () {
            return scope.slots.register({ name: SLOT_CONVERSATION, locale: NS }, EmbeddedConversation)
          })
        }, 'dsh-split-chat: conversation')
      })

      ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'split-chat.open-aside',
            order: 250,
            locale: NS,
            inject: function () {
              return { openAside: openAside }
            }
          },
          MenuEntry
        )
      })
      ctx.slots.inject('sidebar.workspaces.session.row.action', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.row.action',
            id: 'split-chat.open-aside',
            order: 150,
            locale: NS,
            inject: function () {
              return { openAside: openAside }
            }
          },
          RowAction
        )
      })
    }
    //#endregion

    module.exports = {
      name: NAME,
      inject: ['sessions', 'uiWorkspace', 'slots', 'locale', 'sidebarRight'],
      apply: apply
    }
    return module.exports
  }
})
