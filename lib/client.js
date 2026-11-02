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
    /**
     * The glyph the menu row shows, exactly as a shipped row passes one: the
     * baseline `MenuItemButton` takes it as an `icon` prop and owns spacing,
     * sizing, and color, so the row is indistinguishable from a built-in entry.
     */
    var MenuIcon = primitives === null ? undefined : primitives.IconCompareSplitOutlineRegular

    /** Version reported with the capability line (mirrors package.json). */
    var VERSION = '0.2.2'

    /** Labels already reported as degraded; one missing host API logs once, not per render. */
    var warned = {}

    /**
     * Report one degraded host capability once, without ever throwing: a DSH
     * upgrade may rename or remove an internal seam, and the plugin must lose
     * that one feature instead of failing to load as a whole.
     *
     * @param label - stable capability label.
     * @param error - optional underlying error.
     */
    function warnOnce(label, error) {
      if (warned[label] === true) return
      warned[label] = true
      try {
        console.warn('[dsh-split-chat] degraded capability "' + label + '"' + (error === undefined ? '' : ': ' + String(error && error.message ? error.message : error)))
      } catch (_warnError) {
        // A console failure must not matter.
      }
    }

    /**
     * Feature services captured lazily through `ctx.inject(deps, cb)`: the
     * plugin never hard-requires them, so a renamed/removed service disables one
     * feature instead of keeping the plugin pending or failing its activation.
     */
    var host = {
      sidebarRight: undefined,
      sessions: undefined,
      conversation: undefined,
      uiWorkspace: undefined
    }

    /**
     * Capture optional services without making them hard requirements.
     *
     * @param ctx - client root context.
     * @param names - service names to wait for.
     * @param onReady - callback receiving the injected scope (services readable there).
     */
    function capture(ctx, names, onReady) {
      if (typeof ctx.inject !== 'function') {
        warnOnce('inject:' + names.join(','), new Error('ctx.inject is unavailable'))
        return
      }
      try {
        ctx.inject(names, function (scope) {
          try {
            onReady(scope)
          } catch (error) {
            warnOnce('capture:' + names.join(','), error)
          }
        })
      } catch (error) {
        warnOnce('inject:' + names.join(','), error)
      }
    }

    /** Describe the host seams this plugin currently holds, for post-upgrade diagnosis. */
    function hostCapabilities() {
      return {
        version: VERSION,
        sidebarRight: host.sidebarRight !== undefined,
        sessions: host.sessions !== undefined,
        conversation: host.conversation !== undefined,
        uiWorkspace: host.uiWorkspace !== undefined,
        menuItemButton: MenuItemButton !== undefined,
        menuIcon: MenuIcon !== undefined
      }
    }

    /** Client root context, captured by apply() so component handlers can resolve services lazily. */
    var pluginCtx = null

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
      'tab.title': '对话',
      'duplicate.title': '该会话已在主区打开',
      'duplicate.body': '主区和右侧栏不能同时编辑同一个会话。换一个会话在右侧打开，或把主区切到别的会话。',
      'open.failed.title': '无法打开该会话',
      'open.failed.body': '该会话可能已被归档或删除。关闭此标签即可。',
      'cross.title': '发送到另一侧',
      'cross.hint': '点击：把选中的文字（没有选中时取最后一条回复）填入另一侧输入框；Shift+点击：直接发送。',
      'cross.fallback': '另一侧',
      'cross.sent': '已填入另一侧输入框',
      'cross.sentDirect': '已发送到另一侧',
      'cross.empty': '这一侧还没有可以发送的内容',
      'cross.noTarget': '另一侧没有可用的对话',
      'cross.failed': '发送到另一侧失败',
      'unsupported.title': '插件与当前 DSH 版本不兼容',
      'unsupported.body': 'DSH 升级后，插件依赖的某个宿主接口发生了变化。插件已降级运行（其他功能不受影响），更新本插件通常即可恢复。'
    }
    /** English dictionary, key-identical to the Chinese source of truth. */
    var en = {
      'open.aside': 'Open in sidebar',
      'tab.title': 'Chat',
      'duplicate.title': 'This session is open in the main view',
      'duplicate.body': 'The main view and the sidebar cannot edit the same session. Open another session here, or switch the main view first.',
      'open.failed.title': 'This session could not be opened',
      'open.failed.body': 'It may have been archived or deleted. Close this tab to dismiss it.',
      'cross.title': 'Send to the other pane',
      'cross.hint': 'Click: place the selected text (or the latest reply) into the other pane’s composer; Shift-click: send it immediately.',
      'cross.fallback': 'the other pane',
      'cross.sent': 'Placed into the other pane’s composer',
      'cross.sentDirect': 'Sent to the other pane',
      'cross.empty': 'Nothing to send from this pane yet',
      'cross.noTarget': 'There is no conversation on the other side',
      'cross.failed': 'Could not send to the other pane',
      'unsupported.title': 'This plugin is incompatible with the current DSH version',
      'unsupported.body': 'A host interface this plugin relies on changed after a DSH upgrade. The plugin is running in degraded mode (other features still work); updating the plugin usually restores it.'
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
          noteAside(sessionId, 1)
          try {
            yield { ok: true, value: { sessionId: sessionId, reference: reference } }
            await waitAbort(signal)
          } finally {
            noteAside(sessionId, -1)
            scheduleForget(sessionId)
            reference.release()
          }
        }
      }
    }
    //#endregion

    //#region aside tracking + global tabs

    /** How many live aside tabs currently hold each Session (one per mounted dock tab). */
    var asideCounts = new Map()
    /** Listeners of the aside-Session set: the cross-pane button re-renders on changes. */
    var asideListeners = new Set()
    /** Latest sorted aside Session ids; a fresh array per change so React state compares unequal. */
    var asideSnapshot = []

    /** Publish the current aside Session ids to every listener. */
    function publishAside() {
      asideSnapshot = Array.from(asideCounts.keys()).sort()
      asideListeners.forEach(function (listener) {
        try {
          listener()
        } catch (_listenerError) {
          // One stale React listener must not break the resource stream.
        }
      })
    }

    /**
     * Hold or release one aside Session in the module-level set.
     *
     * @param sessionId - the Session a live aside tab shows.
     * @param delta - +1 when its resource opens, -1 when the stream ends.
     */
    function noteAside(sessionId, delta) {
      var next = (asideCounts.get(sessionId) || 0) + delta
      if (next <= 0) asideCounts.delete(sessionId)
      else asideCounts.set(sessionId, next)
      publishAside()
    }

    /** Pending "was this release a user close, or a main-Session switch?" checks. */
    var forgetTimers = {}
    /** Until this instant the dock is still tearing down/reopening during a switch. */
    var switchingUntil = 0

    /** The Session currently filling the main column, if known. */
    function mountedSessionNow() {
      try {
        var sidebarRight = host.sidebarRight
        var mounted = sidebarRight === undefined || sidebarRight === null ? undefined : sidebarRight.mounted
        return mounted === undefined || typeof mounted.getSnapshot !== 'function' ? undefined : mounted.getSnapshot()
      } catch (_mountedNowError) {
        return undefined
      }
    }

    /**
     * Forget a Session's global-aside intent only when its last live copy closed
     * while the main column stayed put (a user close). A release caused by a
     * main-Session switch changes the mounted Session and must keep the intent,
     * otherwise the follow feature would forget its tabs on every switch.
     *
     * @param sessionId - the Session whose resource stream ended.
     */
    function scheduleForget(sessionId) {
      // A main-Session switch unmounts and remounts aside tabs; those releases
      // must not be mistaken for a user close, or the follow would forget its own
      // tabs and the switch-induced intent change would abort the stale sweep.
      if (Date.now() < switchingUntil) return
      if (forgetTimers[sessionId] !== undefined) clearTimeout(forgetTimers[sessionId])
      var mountedAtRelease = mountedSessionNow()
      forgetTimers[sessionId] = setTimeout(function () {
        delete forgetTimers[sessionId]
        if ((asideCounts.get(sessionId) || 0) > 0) return
        if (mountedSessionNow() !== mountedAtRelease) return
        forgetAside(sessionId)
      }, 250)
    }

    /**
     * Sessions the user explicitly asked to keep in the aside. This is the one
     * source of truth for the global follow: host-restored stale copies never
     * join it, and closing the last live copy of a Session leaves it, so a tab
     * closed in one Session cannot be resurrected when another Session's saved
     * dock layout is restored later.
     */
    var intentAside = []
    /** Bumped on every intent change; a running stale sweep stops when it changes. */
    var intentVersion = 0

    /** Record one Session as part of the global aside intent. */
    function rememberAside(sessionId) {
      if (intentAside.indexOf(sessionId) !== -1) return
      intentAside.push(sessionId)
      intentVersion += 1
    }

    /** Drop one Session from the global aside intent once no live copy remains. */
    function forgetAside(sessionId) {
      var index = intentAside.indexOf(sessionId)
      if (index === -1) return
      intentAside.splice(index, 1)
      intentVersion += 1
    }

    /** Read the last persisted right-sidebar surface of one main Session from localStorage. */
    function persistedSurface(sessionId) {
      if (typeof window === 'undefined' || sessionId === undefined) return undefined
      try {
        var raw = window.localStorage.getItem('dsh.sidebar-right.v1.' + sessionId)
        if (raw === null) return undefined
        var parsed = JSON.parse(raw)
        return parsed !== null && parsed.bySession !== undefined ? parsed.bySession[sessionId] : undefined
      } catch (_layoutError) {
        return undefined
      }
    }

    /** Whether the main Session's column was expanded when its layout was last persisted. */
    function persistedExpanded(sessionId) {
      var surface = persistedSurface(sessionId)
      return surface === undefined || surface.layout === undefined ? true : surface.layout.expanded !== false
    }

    /**
     * Keep the plugin's aside tabs visible across main-Session switches.
     *
     * The host owns one docking surface per Session, so a tab recorded in one
     * Session's layout is not drawn while another Session fills the main column.
     * On a Session-to-Session switch this reopens the aside Sessions the previous
     * column was showing under the arriving one; the dock deduplicates by
     * (kind, contentId), so returning to a Session that still carries the records
     * only focuses them.
     *
     * @param ctx - client root context.
     * @returns disposer stopping the follow loop.
     */
    function startGlobalTabs(sidebarRight) {
      var mounted = sidebarRight === undefined || sidebarRight === null ? undefined : sidebarRight.mounted
      if (mounted === undefined || typeof mounted.subscribe !== 'function' || typeof mounted.getSnapshot !== 'function') return function () {}
      if (typeof sidebarRight.openResource !== 'function') {
        warnOnce('global-tabs:openResource', new Error('sidebarRight.openResource is unavailable'))
        return function () {}
      }
      var disposed = false
      var epoch = 0
      var timer = 0
      var sweepTimer = 0
      var leaveTimer = 0
      var previous = mounted.getSnapshot()
      var seedTimer = 0
      var seedAttempts = 0
      var seeded = false
      var seedReady = false
      // After a page reload the host restores the current Session's dock layout:
      // adopt the aside tabs the user actually sees as the initial intent, so the
      // global follow keeps working across the first switch.
      function seedIntent() {
        if (disposed || seeded) return
        seedAttempts += 1
        try {
          var now = mounted.getSnapshot()
          if (now !== undefined && typeof sidebarRight.tabsIn === 'function') {
            var tabs = sidebarRight.tabsIn(now) || []
            for (var t = 0; t < tabs.length; t += 1) {
              var tab = tabs[t]
              var tabSession = tab === undefined || typeof tab.contentId !== 'string' ? undefined : parseAddress(tab.contentId)
              if (tabSession !== undefined) {
                rememberAside(tabSession)
                seeded = true
              }
            }
          }
        } catch (seedError) {
          warnOnce('global-tabs:seed', seedError)
          seeded = true
        }
        if (seeded === false && seedAttempts < 24) seedTimer = setTimeout(seedIntent, 250)
        else seedReady = true
      }
      var off = mounted.subscribe(function () {
        // Snapshot stores notify without arguments: read the committed value.
        var next = mounted.getSnapshot()
        var old = previous
        previous = next
        if (disposed || next === undefined || old === next) return
        switchingUntil = Date.now() + 1500
        // Remove the aside copies from the Session we are leaving. The follow
        // re-creates them in the arriving Session; keeping copies in every visited
        // Session is exactly what made a closed tab resurrect from an old layout.
        var leavePasses = 0
        function sweepLeaving() {
          if (disposed) return
          if (old === undefined || old === next) return
          try {
            if (typeof sidebarRight.tabsIn === 'function' && typeof sidebarRight.closeIn === 'function') {
              var leaving = sidebarRight.tabsIn(old) || []
              for (var l = 0; l < leaving.length; l += 1) {
                var leavingTab = leaving[l]
                if (leavingTab === undefined || typeof leavingTab.contentId !== 'string') continue
                if (parseAddress(leavingTab.contentId) === undefined) continue
                if (typeof leavingTab.id === 'string') sidebarRight.closeIn(old, leavingTab.id)
              }
            }
          } catch (leaveError) {
            warnOnce('global-tabs:leave', leaveError)
          }
          leavePasses += 1
          if (leavePasses < 8) leaveTimer = setTimeout(sweepLeaving, 200)
        }
        leaveTimer = setTimeout(sweepLeaving, 0)
        var wanted = intentAside.filter(function (sessionId) {
          return sessionId !== next
        })
        var wantedIds = {}
        for (var w = 0; w < wanted.length; w += 1) wantedIds[wanted[w]] = true
        // The host may restore this Session's saved dock layout a little after the
        // switch, so keep sweeping for a few seconds: drop every copy that is no
        // longer in the global intent. Closing a tab in any Session therefore
        // removes it everywhere instead of resurrecting it on the next visit.
        var sweepPasses = 0
        var sweepIntentVersion = intentVersion
        function sweepStale() {
          if (disposed) return
          // A user open/close while sweeping changes the intent: stop, so a freshly
          // opened tab is never mistaken for a stale copy.
          if (intentVersion !== sweepIntentVersion) return
          try {
            if (typeof sidebarRight.tabsIn === 'function' && typeof sidebarRight.closeIn === 'function') {
              var existing = sidebarRight.tabsIn(next) || []
              for (var e = 0; e < existing.length; e += 1) {
                var existingTab = existing[e]
                if (existingTab === undefined || typeof existingTab.contentId !== 'string') continue
                var existingSession = parseAddress(existingTab.contentId)
                if (existingSession === undefined || wantedIds[existingSession] === true) continue
                if (typeof existingTab.id === 'string') sidebarRight.closeIn(next, existingTab.id)
              }
            }
          } catch (cleanupError) {
            warnOnce('global-tabs:cleanup', cleanupError)
          }
          sweepPasses += 1
          if (sweepPasses < 20) sweepTimer = setTimeout(sweepStale, 250)
        }
        // On first load, wait until the boot layout has been adopted and seeded as
        // intent; on later Session switches sweep right away.
        sweepTimer = setTimeout(sweepStale, seedReady === true ? 100 : 1400)
        if (wanted.length === 0) return
        var collapseAgain = persistedExpanded(old) === false
        var token = ++epoch
        var attempt = 0
        function tick() {
          if (disposed || token !== epoch) return
          var failed = false
          for (var i = 0; i < wanted.length; i += 1) {
            try {
              sidebarRight.openResource(addressOf(wanted[i]), { kind: KIND, preferNewPane: false })
            } catch (_openError) {
              // The arriving Session's store is minted during the next render, and a
              // freshly created session has no dock until its first message: retry.
              failed = true
              break
            }
          }
          // A blank new-session hero page may have no dock for a while (until its
          // first message), so keep the follow alive rather than dropping the tabs.
          if (failed && attempt < 120) {
            attempt += 1
            timer = setTimeout(tick, 250)
            return
          }
          if (collapseAgain) {
            try {
              if (sidebarRight.isExpanded() === true) sidebarRight.toggleExpanded()
            } catch (_collapseError) {
              // No surface to collapse: nothing to restore.
            }
          }
        }
        timer = setTimeout(tick, 30)
      })
      seedTimer = setTimeout(seedIntent, 800)
      return function () {
        disposed = true
        epoch += 1
        if (timer !== 0) clearTimeout(timer)
        if (sweepTimer !== 0) clearTimeout(sweepTimer)
        if (leaveTimer !== 0) clearTimeout(leaveTimer)
        if (seedTimer !== 0) clearTimeout(seedTimer)
        off()
      }
    }
    //#endregion

    //#region cross-pane action

    /** Show a short-lived confirmation toast without depending on a UI framework. */
    function toast(message) {
      if (typeof document === 'undefined' || document.body === undefined || document.body === null) return
      var element = document.createElement('div')
      element.className = 'dsc-toast'
      element.textContent = message
      document.body.appendChild(element)
      setTimeout(function () {
        element.className = 'dsc-toast dsc-toast-out'
      }, 1500)
      setTimeout(function () {
        element.remove()
      }, 2000)
    }

    /** The pane root owning one composer control: nearest ancestor that contains a chat flow. */
    function paneRootOf(element) {
      var node = element
      while (node !== null && node !== undefined) {
        if (typeof node.querySelector === 'function' && node.querySelector('[data-chat-flow]') !== null) return node
        node = node.parentElement
      }
      return null
    }

    /** Selected text inside this pane, else the pane's latest assistant reply. */
    function quoteFromPane(element) {
      var pane = paneRootOf(element)
      if (pane === null) return ''
      try {
        var selection = window.getSelection()
        if (selection !== null && selection.isCollapsed !== true && selection.rangeCount > 0) {
          var selected = String(selection.toString() || '').trim()
          var anchor = selection.anchorNode
          if (selected !== '' && anchor !== null && pane.contains(anchor)) return selected
        }
      } catch (_selectionError) {
        // Selection APIs are best-effort; fall through to the last reply.
      }
      var flow = pane.querySelector('[data-chat-flow]')
      if (flow === null) return ''
      // The chat flow exposes user/turn-process/assistant-step/turn-tail nodes; the
      // answer body lives in a step node, while turn-tail carries timing/usage.
      var steps = flow.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
      var fallbackStep = ''
      for (var i = steps.length - 1; i >= 0; i -= 1) {
        var text = String(steps[i].innerText || '').trim()
        if (text === '') continue
        if (steps[i].getAttribute('data-turn-process-answer') === 'true') return text
        if (fallbackStep === '') fallbackStep = text
      }
      if (fallbackStep !== '') return fallbackStep
      var rows = flow.querySelectorAll('[data-chat-node-key]')
      for (var j = rows.length - 1; j >= 0; j -= 1) {
        var kind = rows[j].getAttribute('data-chat-flow-kind')
        if (kind === 'turn-tail' || kind === 'user') continue
        var tail = String(rows[j].innerText || '').trim()
        if (tail !== '') return tail
      }
      return ''
    }

    /** The aside Session currently painted in the right column, if any. */
    function visibleAsideSession() {
      if (typeof document === 'undefined') return undefined
      try {
        var nodes = document.querySelectorAll('[data-sidebar-right-panel] [data-split-chat-session]')
        for (var i = 0; i < nodes.length; i += 1) {
          if (nodes[i].getClientRects().length > 0) {
            var sessionId = nodes[i].getAttribute('data-split-chat-session')
            if (sessionId !== null && sessionId !== '') return sessionId
          }
        }
      } catch (_visibleError) {
        // Fall back to the tracked set.
      }
      return undefined
    }

    /** The main Session the conversation currently fills the main column with. */
    function mainSessionId(ctx) {
      try {
        var sidebarRight = host.sidebarRight
        var mounted = sidebarRight === undefined || sidebarRight === null ? undefined : sidebarRight.mounted
        var onScreen = mounted === undefined || typeof mounted.getSnapshot !== 'function' ? undefined : mounted.getSnapshot()
        if (onScreen !== undefined) return onScreen
      } catch (_mountedError) {
        // Fall through to the retained-row scan.
      }
      try {
        var sessions = host.sessions
        var byId = sessions.list.getSnapshot().byId || {}
        for (var key in byId) {
          var row = byId[key]
          if (row !== undefined && row.retainedBy !== undefined && row.retainedBy.mainView > 0) return key
        }
      } catch (_mainError) {
        // Unknown until the session list hydrates.
      }
      return undefined
    }

    /** Resolve the other side of the pane showing `sessionId`. */
    function crossTargetFor(ctx, sessionId, asideIds) {
      var mainId = mainSessionId(ctx)
      if (mainId === undefined) return undefined
      if (sessionId !== mainId) return { id: mainId, inMain: false }
      var visible = visibleAsideSession()
      if (visible !== undefined && visible !== sessionId) return { id: visible, inMain: true }
      for (var i = asideIds.length - 1; i >= 0; i -= 1) {
        if (asideIds[i] !== sessionId) return { id: asideIds[i], inMain: true }
      }
      return undefined
    }

    /**
     * Place text into another Session's composer, optionally submitting it. Uses
     * the conversation service's per-Session input shell, the same face the
     * composer itself drives.
     *
     * @param ctx - client root context.
     * @param targetSessionId - the Session whose composer receives the text.
     * @param text - the text to place.
     * @param direct - submit the resulting draft immediately.
     */
    function pushAcross(ctx, targetSessionId, text, direct) {
      var conversation = host.conversation
      var input = conversation === undefined || conversation === null ? undefined : conversation.input
      if (input === undefined || typeof input.shell !== 'function') throw new Error('conversation input service unavailable')
      var shell = input.shell(targetSessionId)
      var state = shell.state.getSnapshot()
      var draft = typeof state.draft === 'string' ? state.draft : ''
      var next = draft.trim() === '' ? text : draft.replace(/\s+$/, '') + '\n\n' + text
      shell.actions.setDraft(next)
      if (direct === true) shell.actions.submit()
    }
    //#endregion

    //#region components

    /** Shown when the host contract changed and one seat can no longer render. */
    function UnavailableNotice(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      return h(
        'div',
        { className: 'dsc-notice', role: 'status' },
        h('div', { className: 'dsc-notice-title' }, t('unsupported.title')),
        h('div', { className: 'dsc-notice-body' }, t('unsupported.body'))
      )
    }

    /** Tab-title fallback for the error boundary: a chip must stay plain text. */
    function TabTitleFallback(props) {
      return typeof props.t === 'function' ? props.t('tab.title') : 'Chat'
    }

    /**
     * Wrap one slot seat in an error boundary: when a DSH upgrade breaks that
     * seat's host props, only that seat degrades (notice or nothing) while the
     * rest of the dock keeps working.
     *
     * @param name - seat name used in the warning.
     * @param Component - the seat component.
     * @param Fallback - fallback component, or undefined for "render nothing".
     */
    function withSeatBoundary(name, Component, Fallback) {
      return class SeatBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { failed: false }
        }

        static getDerivedStateFromError() {
          return { failed: true }
        }

        componentDidCatch(error) {
          warnOnce('render:' + name, error)
        }

        render() {
          if (this.state.failed === true) return typeof Fallback === 'function' ? h(Fallback, this.props) : null
          return h(Component, this.props)
        }
      }
    }

    /** Call one optional hook prop; a host that dropped the prop yields the fallback. */
    function callHook(hook, updater, fallback) {
      return typeof hook === 'function' ? hook(updater) : fallback
    }

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
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      var session = callHook(props.useSession, function (value) {
        return value
      }, { blank: true, awaitingFirstTurn: false, running: false, promptAttempted: false, openState: 'loading' })
      // Prefer the dedicated retention hook; the list row carries the same map
      // when the hook prop is absent on an older shell.
      var useSessionRetainInfo = props.useSessionRetainInfo
      var useSessions = props.useSessions
      var mainCount
      if (useSessionRetainInfo !== undefined) {
        mainCount = callHook(useSessionRetainInfo, function (info) {
          return info === undefined ? 0 : ((info.retainedBy && info.retainedBy.mainView) || 0)
        }, 0)
      } else {
        mainCount = callHook(useSessions, function (state) {
          var row = state.byId[sessionId]
          return row === undefined || row.retainedBy === undefined ? 0 : row.retainedBy.mainView || 0
        }, 0)
      }
      var activeTargets = callHook(props.useConversation, function (value) {
        return value === undefined || value === null ? undefined : value.activeTargets
      }, undefined)
      var summaryBlank = callHook(useSessions, function (state) {
        var row = state.byId[sessionId]
        return row === undefined ? undefined : row.blank
      }, undefined)

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
      if (typeof props.renderFactorySlot !== 'function') {
        warnOnce('conversation.content:renderFactorySlot', new Error('host props lost renderFactorySlot'))
        return h(UnavailableNotice, { t: t })
      }
      try {
        return props.renderFactorySlot(
          'conversation.content',
          { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero: hero },
          { slots: { views: FixedChatView } }
        )
      } catch (error) {
        warnOnce('conversation.content', error)
        return h(UnavailableNotice, { t: t })
      }
    }

    /**
     * One right-sidebar tab body: read the tab's resource and bind the Session
     * reference around our conversation slot.
     */
    function SidebarSessionTab(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      // The tab record is committed before this seat dispatches; tolerate a
      // mid-teardown read without breaking the hook order.
      var tab
      if (typeof props.useTabInfo === 'function') {
        try {
          tab = props.useTabInfo().tab
        } catch (_tabNotCommitted) {
          tab = undefined
        }
      }
      var resource
      if (typeof props.useResource === 'function') {
        try {
          resource = props.useResource(tab === undefined ? '' : tab.contentId)
        } catch (error) {
          warnOnce('tab-body:useResource', error)
          resource = undefined
        }
      }
      var children
      if (typeof props.renderSlot !== 'function' || props.SessionProvider === undefined) {
        warnOnce('tab-body:props', new Error('host props lost renderSlot or SessionProvider'))
        children = h(UnavailableNotice, { t: t })
      } else if (resource !== undefined && resource.value !== undefined) {
        try {
          children = h(props.SessionProvider, { session: resource.value.reference }, props.renderSlot(SLOT_CONVERSATION, {}))
        } catch (error) {
          warnOnce('tab-body:session-provider', error)
          children = h(UnavailableNotice, { t: t })
        }
      } else if (resource !== undefined && resource.status === 'failed') {
        children = h(
          'div',
          { className: 'dsc-notice', role: 'status' },
          h('div', { className: 'dsc-notice-title' }, t('open.failed.title')),
          h('div', { className: 'dsc-notice-body' }, t('open.failed.body'))
        )
      } else {
        children = null
      }
      var sessionId = resource !== undefined && resource.value !== undefined ? resource.value.sessionId : undefined
      return h(
        'div',
        {
          className: 'dsc-root',
          'data-split-chat': '',
          'data-split-chat-session': sessionId === undefined ? undefined : sessionId
        },
        children
      )
    }

    /**
     * The tab chip title: the live Session title, falling back to the generic
     * copy. The shell wraps the title seat in `display: contents`, so return
     * text only (inline content is all the chip expects).
     */
    function TabTitle(props) {
      var t = typeof props.t === 'function' ? props.t : function () { return 'Chat' }
      var sessionId
      if (typeof props.useTabInfo === 'function') {
        try {
          sessionId = parseAddress(props.useTabInfo().tab.contentId)
        } catch (_tabNotCommitted) {
          sessionId = undefined
        }
      }
      var title = callHook(props.useSessions, function (state) {
        var row = sessionId === undefined ? undefined : state.byId[sessionId]
        return row === undefined ? undefined : row.title
      }, undefined)
      return title === undefined || title === '' ? t('tab.title') : title
    }

    /**
     * The session row's "..." menu row: open this Session in the right sidebar.
     * `MenuItemButton` renders the styled `role="menuitem"` button itself; the
     * plain-button branch only runs when the baseline primitive is unavailable.
     */
    function MenuEntry(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      if (typeof props.openAside !== 'function') return null
      var useMenuOpenState = props.useMenuOpenState
      var menuState = typeof useMenuOpenState === 'function' ? useMenuOpenState() : undefined
      var setMenuOpen = menuState === undefined ? undefined : menuState[1]
      // Action only, like every shipped row ("重命名", "归档会话"): the menu is
      // already anchored to one Session, so repeating its title there is longer
      // than the built-in rows and buys nothing. The title stays available on
      // the row itself and in the tooltip of the hover action.
      var label = t('open.aside')
      var select = function () {
        try {
          if (setMenuOpen !== undefined) setMenuOpen(false)
          props.openAside(props.sessionId)
        } catch (error) {
          warnOnce('menu:openAside', error)
        }
      }
      if (MenuItemButton !== undefined) {
        return h(
          MenuItemButton,
          { onSelect: select, icon: MenuIcon === undefined ? undefined : h(MenuIcon, {}) },
          label
        )
      }
      return h('button', { type: 'button', role: 'menuitem', className: 'dsc-menu-item', onClick: select }, label)
    }

    /** The session row's hover button: the same action as the menu row. */
    function RowAction(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      if (typeof props.openAside !== 'function') return null
      return h(
        'button',
        {
          type: 'button',
          className: 'dsc-action',
          title: t('open.aside'),
          'aria-label': t('open.aside'),
          onClick: function () {
            try {
              props.openAside(props.sessionId)
            } catch (error) {
              warnOnce('row-action:openAside', error)
            }
          }
        },
        '\u29C9'
      )
    }

    /** Subscribe a component to the module-level aside-Session set. */
    function useAsideIds() {
      var state = React.useState(function () {
        return asideSnapshot
      })
      React.useEffect(function () {
        var listener = function () {
          state[1](asideSnapshot)
        }
        asideListeners.add(listener)
        listener()
        return function () {
          asideListeners.delete(listener)
        }
      }, [])
      return state[0]
    }

    /**
     * Composer control on the left of the submit button: move the pane's
     * selected text (or its latest reply) into the other pane's input box.
     * Shift-click submits it there instead of leaving it for review.
     */
    function CrossPaneButton(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      if (pluginCtx === null) return null
      var sessionId = props.sessionId
      var asideIds = useAsideIds()
      // Subscribe to the main-Session store so the control re-renders on a switch.
      callHook(props.useSessions, function () {
        return mainSessionId(pluginCtx)
      }, undefined)
      var target
      try {
        target = crossTargetFor(pluginCtx, sessionId, asideIds)
      } catch (error) {
        warnOnce('cross-pane:target', error)
        return null
      }
      if (target === undefined) return null
      var title = t('cross.hint')
      var name = t('cross.fallback')
      try {
        var sessions = host.sessions
        var rows = sessions === undefined || sessions === null ? {} : sessions.list.getSnapshot().byId || {}
        var row = rows[target.id]
        if (row !== undefined && row.title !== undefined && row.title !== '') name = row.title
      } catch (_rowsError) {
        // Fall back to the generic label.
      }
      title = t('cross.title') + '：' + name + '\n' + t('cross.hint')
      return h(
        'button',
        {
          type: 'button',
          className: 'dsc-cross',
          'data-dsc-cross': '',
          title: title,
          'aria-label': t('cross.title'),
          onClick: function (event) {
            try {
              var freshTarget = crossTargetFor(pluginCtx, sessionId, asideIds)
              if (freshTarget === undefined) {
                toast(t('cross.noTarget'))
                return
              }
              var text = quoteFromPane(event.currentTarget)
              if (text === '') {
                toast(t('cross.empty'))
                return
              }
              var direct = event.shiftKey === true
              pushAcross(pluginCtx, freshTarget.id, text, direct)
              toast(direct ? t('cross.sentDirect') : t('cross.sent'))
            } catch (error) {
              console.error('dsh-split-chat: cross-pane action failed', error)
              toast(t('cross.failed'))
            }
          }
        },
        '\u21C4'
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
      '.dsc-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}' +
      '.dsc-cross{width:26px;height:26px;border:0;background:none;border-radius:6px;cursor:pointer;' +
      'color:var(--dsw-alias-label-tertiary,#999);padding:0;font-size:15px;line-height:26px;' +
      'display:inline-flex;align-items:center;justify-content:center;flex:none}' +
      '.dsc-cross:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));' +
      'color:var(--dsw-alias-label-primary,#111)}' +
      '.dsc-toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:9999;' +
      'padding:6px 12px;border-radius:8px;font-size:12px;line-height:18px;pointer-events:none;' +
      'background:var(--dsw-alias-bg-layer-3,#2b2b2e);color:var(--dsw-alias-label-primary,#fff);' +
      'box-shadow:var(--dsw-elevation-prominent,0 6px 20px rgba(0,0,0,.28));opacity:1;' +
      'transition:opacity .3s ease}' +
      '.dsc-toast-out{opacity:0}'

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
      pluginCtx = ctx
      try {
        injectCss()
      } catch (cssError) {
        warnOnce('css', cssError)
      }

      /** Run one host registration; a changed host seam disables that feature only. */
      function guardedEffect(label, setup) {
        try {
          ctx.effect(function () {
            try {
              return setup()
            } catch (error) {
              warnOnce(label, error)
              return function () {}
            }
          }, 'dsh-split-chat: ' + label)
        } catch (error) {
          warnOnce('effect:' + label, error)
        }
      }

      function guardedInject(name, register) {
        if (ctx.slots === undefined || ctx.slots === null || typeof ctx.slots.inject !== 'function') {
          warnOnce('slots.inject', new Error('ctx.slots.inject is unavailable; session-row/composer entry points are disabled'))
          return
        }
        try {
          ctx.slots.inject(name, register)
        } catch (error) {
          warnOnce('slots.inject:' + name, error)
        }
      }

      // Feature services are captured lazily and never become hard requirements:
      // a DSH upgrade that renames one disables that feature, not the plugin.
      capture(ctx, ['sidebarRight'], function (scope) {
        host.sidebarRight = scope.sidebarRight
        guardedEffect('global tabs', function () {
          return startGlobalTabs(host.sidebarRight)
        })
      })
      capture(ctx, ['sessions'], function (scope) {
        host.sessions = scope.sessions
      })
      capture(ctx, ['conversation'], function (scope) {
        host.conversation = scope.conversation
      })
      capture(ctx, ['uiWorkspace'], function (scope) {
        host.uiWorkspace = scope.uiWorkspace
      })

      // Deferred diagnostic: after the lazy captures settle, log the version and
      // which host seams are present; name any feature still missing.
      setTimeout(function () {
        try {
          console.info('[dsh-split-chat] ' + VERSION + ' host capabilities ' + JSON.stringify(hostCapabilities()))
        } catch (_capabilityLogError) {
          // Diagnostics are best-effort.
        }
        if (host.sidebarRight === undefined) warnOnce('host:sidebarRight', new Error('sidebarRight was not captured; the right-sidebar feature is disabled'))
        if (host.sessions === undefined) warnOnce('host:sessions', new Error('sessions was not captured; tab content is disabled'))
      }, 3000)
      var t = function (key) {
        return key
      }
      var locale = ctx.locale
      if (locale !== undefined && locale !== null && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        guardedEffect('dictionaries', function () {
          return locale.register(NS, { zh: zh, en: en })
        })
        t = locale.bind(NS)
      } else {
        warnOnce('locale', new Error('locale service is unavailable; showing raw keys'))
      }

      // One shared aside set travels with the user across main-Session switches;
      // it starts as soon as the lazy sidebarRight capture above resolves.


      /**
       * Open one Session in the right sidebar; fall back to the main view when
       * no dock surface is mounted (the hero page has nothing to open into).
       *
       * @param sessionId - the Session the row stands for.
       */
      function openAside(sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return
        rememberAside(sessionId)
        var sidebarRight = host.sidebarRight
        if (sidebarRight !== undefined && sidebarRight !== null && typeof sidebarRight.openResource === 'function') {
          try {
            sidebarRight.openResource(addressOf(sessionId), { kind: KIND, preferNewPane: false })
            return
          } catch (error) {
            warnOnce('openAside:openResource', error)
          }
        } else {
          warnOnce('openAside:sidebarRight', new Error('sidebarRight.openResource is unavailable'))
        }
        var uiWorkspace = host.uiWorkspace
        if (uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.openSession === 'function') {
          try {
            uiWorkspace.openSession(sessionId)
            return
          } catch (fallbackError) {
            warnOnce('openAside:uiWorkspace', fallbackError)
          }
        }
        toast(t('unsupported.body'))
      }

      var conversationChildren = {}
      conversationChildren[SLOT_CONVERSATION] = { kind: 'single', scope: 'session' }

      if (typeof ctx.inject !== 'function') {
        warnOnce('inject', new Error('ctx.inject is unavailable; the resource provider and tab type are disabled'))
      } else {
        try {
          ctx.inject(['resources', 'sidebarRightTabs', 'sessions'], function (scope) {
            var scopedEffect = function (label, setup) {
              try {
                scope.effect(function () {
                  try {
                    return setup()
                  } catch (error) {
                    warnOnce(label, error)
                    return function () {}
                  }
                }, 'dsh-split-chat: ' + label)
              } catch (error) {
                warnOnce('effect:' + label, error)
              }
            }
            scopedEffect('resource provider', function () {
              return scope.resources.register(sessionChatResourceProvider(scope.sessions))
            })
            scopedEffect('tab type', function () {
              return scope.sidebarRightTabs.register({
                id: TAB_ID,
                kind: KIND,
                patterns: [ADDRESS_PREFIX + '**'],
                priority: 'extension',
                canOpen: function (address) {
                  return parseAddress(address) !== undefined
                },
                title: function (address) {
                  try {
                    var sessionId = parseAddress(address)
                    if (sessionId === undefined) return t('tab.title')
                    var current = host.sessions
                    var row = current === undefined || current === null ? undefined : current.list.getSnapshot().byId[sessionId]
                    return row === undefined || row.title === undefined || row.title === '' ? t('tab.title') : row.title
                  } catch (error) {
                    warnOnce('tab-type:title', error)
                    return t('tab.title')
                  }
                }
              })
            })
            scopedEffect('tab body', function () {
              return scope.slots.inject('sidebar.right.pane.tab', function () {
                return scope.slots.register(
                  { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, children: conversationChildren },
                  withSeatBoundary('tab-body', SidebarSessionTab, UnavailableNotice)
                )
              })
            })
            scopedEffect('tab title', function () {
              return scope.slots.inject('sidebar.right.pane.tab.title', function () {
                return scope.slots.register(
                  { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS },
                  withSeatBoundary('tab-title', TabTitle, TabTitleFallback)
                )
              })
            })
            scopedEffect('conversation', function () {
              return scope.slots.inject(SLOT_CONVERSATION, function () {
                return scope.slots.register(
                  { name: SLOT_CONVERSATION, locale: NS },
                  withSeatBoundary('conversation', EmbeddedConversation, UnavailableNotice)
                )
              })
            })
          })
        } catch (injectError) {
          warnOnce('inject:resources', injectError)
        }
      }

      guardedInject('sidebar.workspaces.session.menu.item', function () {
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
          withSeatBoundary('menu-row', MenuEntry, undefined)
        )
      })
      guardedInject('sidebar.workspaces.session.row.action', function () {
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
          withSeatBoundary('row-action', RowAction, undefined)
        )
      })
      // Composer control in every conversation (main column and aside tabs).
      guardedInject('conversation.input.right', function () {
        return ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'split-chat.cross-pane',
            order: 900,
            locale: NS
          },
          withSeatBoundary('cross-pane', CrossPaneButton, undefined)
        )
      })
    }
    //#endregion

    module.exports = {
      name: NAME,
      // Hard-require only the stable core seams (slots + locale); the feature
      // services (sidebarRight / sessions / uiWorkspace) are resolved lazily so
      // a DSH upgrade that renames one of them degrades that feature instead of
      // keeping the whole plugin pending forever.
      inject: ['slots', 'locale'],
      apply: function (ctx) {
        try {
          return apply(ctx)
        } catch (error) {
          try {
            console.error('[dsh-split-chat] apply threw: ' + String((error && error.stack) || error))
          } catch (_logError) {
            // Keep the original failure.
          }
          throw error
        }
      }
    }
    return module.exports
  }
})
