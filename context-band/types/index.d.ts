export type Percent = number

declare module 'claude-code' {
  interface PluginState {
    'context-band': { warned: boolean; busy: boolean; menuOpen: boolean; compactAfterTurn: boolean }
  }
}
