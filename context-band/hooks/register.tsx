import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Footer turns yellow here (a good moment to compact), red at WARN_AT.
const SUGGEST_AT = 60
const WARN_AT = 80
const KEEP_PLAN = 'Keep the current plan, open decisions, file paths and next steps.'
// Mirrors the project rule: durable decisions go to memory before compaction.
const SAVE_PROMPT =
  'Bu oturumdaki kalıcı kararları ve açık konuların güncel durumunu, CLAUDE.md hafıza kurallarına uyarak hafızaya yaz. Yeni iş başlatma; bitince kısaca neyi kaydettiğini söyle.'

const warned = atom({ plugin: 'context-band', key: 'warned' } as const, false)
const busy = atom({ plugin: 'context-band', key: 'busy' } as const, false)
const menuOpen = atom({ plugin: 'context-band', key: 'menuOpen' } as const, false)
const compactAfterTurn = atom({ plugin: 'context-band', key: 'compactAfterTurn' } as const, false)

function tone(percent: number) {
  return percent >= WARN_AT ? 'error' : percent >= SUGGEST_AT ? 'warning' : 'text'
}

// Desktop draws a real bar; a semi-transparent track reads on light and dark.
function barSvg(percent: number): string {
  const w = 160
  const fill = Math.round((Math.min(100, Math.max(0, percent)) / 100) * w)
  const color = percent >= WARN_AT ? '#dc2626' : percent >= SUGGEST_AT ? '#d97706' : '#4f7fdc'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="8" viewBox="0 0 ${w} 8">` +
    `<rect width="${w}" height="8" rx="4" fill="#80808040"/>` +
    (fill > 0 ? `<rect width="${Math.max(fill, 8)}" height="8" rx="4" fill="${color}"/>` : '') +
    `</svg>`
  )
}

function bar(percent: number): string {
  const filled = Math.round(Math.min(100, Math.max(0, percent)) / 10)
  return '▓'.repeat(filled) + '░'.repeat(10 - filled)
}

async function compact($: EngineInterface, instructions?: string) {
  await update($, menuOpen, () => false)
  await update($, busy, () => true)
  try {
    const r = await $.session.compact(instructions ? { instructions } : undefined)
    $.ui.toast(r.skip ? `Compact skipped: ${r.skip}` : 'Context compacted')
    await update($, warned, () => false)
  } finally {
    await update($, busy, () => false)
  }
}

// One model turn: Claude writes the durable state to memory.
async function saveToMemory($: EngineInterface, thenCompact: boolean) {
  await update($, menuOpen, () => false)
  await update($, compactAfterTurn, () => thenCompact)
  await $.prompt.submit({ text: SAVE_PROMPT })
}

async function toggleMenu($: EngineInterface) {
  await update($, menuOpen, open => !open)
}

async function closeMenu($: EngineInterface) {
  await update($, menuOpen, () => false)
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (await read($, compactAfterTurn)) {
      await update($, compactAfterTurn, () => false)
      // Not awaited: the compaction runs once the session is idle again.
      void compact($, KEEP_PLAN)
      return result
    }
    const percent = (await $.session.usage()).context.percent ?? 0
    const isWarned = await read($, warned)
    if (percent >= WARN_AT && !isWarned) {
      await update($, warned, () => true)
      $.ui.toast(`Context ${percent}% full — consider compacting`)
    } else if (percent < WARN_AT && isWarned) {
      await update($, warned, () => false)
    }
    return result
  })

  // The prompt footer, between the permission mode and the model: no frame of
  // its own. The label itself is the button that toggles the menu in place.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    // The plain call is free: the status line's own figures, no API request.
    const { context } = await $.session.usage()
    if (context.percent === undefined) return next(e)

    const percent = context.percent
    const label = percent >= SUGGEST_AT ? `Context ${percent}% · compact?` : `Context ${percent}%`
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        {e.props.modes.length > 0 ? <Text dimColor>{e.props.modes.join(' & ')}</Text> : null}
        {percent >= SUGGEST_AT ? (
          <Button key="menu" plain onPress={() => void toggleMenu($)}>
            <Text color={tone(percent)}>{label}</Text>
          </Button>
        ) : (
          <Button key="menu" plain dimColor label={label} onPress={() => void toggleMenu($)} />
        )}
      </Box>
    )
  })

  // The menu opens right above the prompt (a side Pane would take the window).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, menuOpen))) return next(e)

    const { context } = await $.session.usage()
    const percent = context.percent ?? 0
    const isBusy = await read($, busy)
    const tokensK = context.tokens !== undefined ? Math.round(context.tokens / 1000) : undefined
    const windowK = Math.round(context.window / 1000)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els

    const run = (value: string) => {
      if (isBusy && value !== 'close') return
      if (value === 'compact') void compact($)
      if (value === 'compact-plan') void compact($, KEEP_PLAN)
      if (value === 'save') void saveToMemory($, false)
      if (value === 'save-compact') void saveToMemory($, true)
      if (value === 'close') void closeMenu($)
    }

    return (
      <Box flexDirection="row" gap={1}>
        {'Svg' in els ? (
          <els.Svg source={barSvg(percent)} alt={`Context ${percent}% full`} width={160} height={8} />
        ) : (
          <Text color={tone(percent)}>{bar(percent)}</Text>
        )}
        <Text color={tone(percent)}>{percent}%</Text>
        {tokensK !== undefined ? (
          <Text dimColor>
            {tokensK}k / {windowK}k
          </Text>
        ) : null}
        {'Select' in els ? (
          <els.Select
            key="actions"
            value="menu"
            options={[
              { value: 'menu', label: isBusy ? 'Compacting… · Sıkıştırılıyor' : 'Actions · İşlemler' },
              { value: 'compact', label: 'Compact · Sıkıştır' },
              { value: 'compact-plan', label: 'Compact, keep plan · Planı koruyarak sıkıştır' },
              { value: 'save', label: 'Save to memory · Hafızaya kaydet' },
              { value: 'save-compact', label: 'Save, then compact · Kaydet, sonra sıkıştır' },
              { value: 'close', label: 'Close · Kapat' },
            ]}
            onSelect={(value: string) => run(value)}
          />
        ) : (
          <Box flexDirection="row" gap={1}>
            <Button key="compact" label="Compact" onPress={() => run('compact')} />
            <Button key="close" label="Close" onPress={() => run('close')} />
          </Box>
        )}
      </Box>
    )
  })
}
