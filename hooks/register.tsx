import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Usage } from '../types'

const PANE = 'usage-limits'
const TITLE = 'Лимиты'
const usage = atom(
  { plugin: 'usage-limits', key: 'usage' } as const,
  { limits: [], tokens: 0, base: {} },
  { shape: 'usage-1' },
)

const NAMES: Record<string, string> = { five_hour: '5 часов', seven_day: 'Неделя' }

const fmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`

const bar = (pct: number, width: number) => {
  const full = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

const resetIn = (iso?: string) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!(ms > 0)) return ''
  const h = Math.floor(ms / 3.6e6)
  const m = Math.floor((ms % 3.6e6) / 6e4)
  return h >= 24 ? `сброс через ${Math.floor(h / 24)}д ${h % 24}ч` : `сброс через ${h}ч ${m}м`
}

type Line = { name: string; pct: number; used: number | null; total: number | null; session: number; reset: string }

const lines = (s: Usage): Line[] =>
  s.limits
    .filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')
    .map(l => {
      const b = s.base[l.kind]
      const dTok = b ? s.tokens - b.tokens : 0
      const dPct = b ? l.percentUsed - b.percent : 0
      // Capacity estimate: tokens this session spent per percent the window moved.
      const total = dPct >= 1 && dTok > 0 ? (dTok / dPct) * 100 : null
      return {
        name: NAMES[l.kind] ?? l.kind,
        pct: l.percentUsed,
        used: total ? (total * l.percentUsed) / 100 : null,
        total,
        session: dTok,
        reset: resetIn(l.resetsAt),
      }
    })

const tokText = (l: Line) =>
  l.total && l.used !== null ? `≈${fmt(l.used)} / ≈${fmt(l.total)} ток.` : `сессия: ${fmt(l.session)} ток.`

const summary = (s: Usage) => {
  const ls = lines(s)
  if (ls.length === 0) return 'Лимиты: нет данных (появятся после первого ответа, только для Pro/Max)'
  return ls.map(l => `${l.name} ${bar(l.pct, 10)} ${l.pct}% · ${tokText(l)}`).join('  |  ')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'limits', description: 'Показать панель лимитов (5 часов / неделя)' })
    const now = await $.session.usage()
    await update($, usage, u => ({ ...u, limits: now.rateLimits }))
    $.ui.status(summary(await read($, usage)))
    void $.ui.open({ id: PANE, title: TITLE, columns: 34, rows: 9 })
    return next(e)
  })

  on('command.run', { command: 'limits' }, async $ => {
    const now = await $.session.usage()
    await update($, usage, u => ({ ...u, limits: now.rateLimits.length ? now.rateLimits : u.limits }))
    const s = await read($, usage)
    $.ui.status(summary(s))
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 34, rows: 9 })
    const text = lines(s)
      .map(l => `${l.name}: ${bar(l.pct, 20)} ${l.pct}%  ${tokText(l)}  ${l.reset}`)
      .join('\n') || summary(s)
    return {
      text: opened.isPlaced
        ? text
        : `${text}\n(Панель не размещена: ${opened.reason}. Цифры также в строке состояния под полем ввода.)`,
    }
  })

  // Tokens this session spent: input + output + cache writes (cache reads weigh little in limits).
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = r.usage
    if (u && !e.agentId) {
      const spent = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens
      await update($, usage, s => ({ ...s, tokens: s.tokens + spent }))
      $.ui.status(summary(await read($, usage)))
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, s => {
      const base = { ...s.base }
      for (const l of e.rateLimits) {
        const b = base[l.kind]
        // New window (reset) or first reading: start measuring from here.
        if (!b || l.percentUsed < b.percent) base[l.kind] = { percent: l.percentUsed, tokens: s.tokens }
      }
      return { ...s, limits: e.rateLimits, base }
    })
    $.ui.status(summary(await read($, usage)))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s: Usage = await read($, usage)
    const width = Math.max(10, Math.min(24, (e.viewport?.columns ?? 34) - 10))
    const shown = lines(s)

    if (shown.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Нет данных о лимитах.</Text>
          <Text dimColor>Появятся после первого ответа</Text>
          <Text dimColor>(только для подписки Pro/Max).</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {shown.map(l => (
          <Box key={l.name} flexDirection="column" marginBottom={1}>
            <Text bold>
              {l.name}: {l.pct}%
            </Text>
            <Text color={l.pct >= 90 ? 'red' : l.pct >= 70 ? 'yellow' : 'green'}>{bar(l.pct, width)}</Text>
            <Text>{tokText(l)}</Text>
            <Text dimColor>{l.reset}</Text>
          </Box>
        ))}
        <Text dimColor>Всего за сессию: {fmt(s.tokens)} ток.</Text>
      </Box>
    )
  })
}
