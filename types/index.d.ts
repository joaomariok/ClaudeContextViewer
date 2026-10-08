export type Row = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

export type View = {
  model: string
  tokens: number
  window: number
  percent: number
  compactAt?: number
  rows: Row[]
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  usd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-viewer': { view: View | null; promptedAt: number | null }
  }
}
