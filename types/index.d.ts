export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
/** Session tokens and the window's percent when this session first saw it. */
export type Base = { percent: number; tokens: number }
export type Usage = { limits: Limit[]; tokens: number; base: Record<string, Base> }

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': { usage: Shaped<Usage> }
  }
}
