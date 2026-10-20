/**
 * Host half of dsh-split-chat: no Host services are needed.
 *
 * The plugin exists to keep its Loader entry mounted so the client half
 * (`./client`) is composed into the Web boot graph and served under
 * `/plugins`; every behaviour lives in `lib/client.js`.
 *
 * @module dsh-split-chat
 */

/** Cordis plugin name; must equal the package name so the client bundle id matches. */
export const name = 'dsh-split-chat'

/** Does nothing: the whole feature is browser-side. */
export function apply() {}
