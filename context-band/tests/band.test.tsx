import { describe, expect, test } from 'claude-code/testing'

const FOOTER = { plugin: 'context-band', component: 'SessionMode' as const, props: { modes: [] as string[] } }
const MENU = {
  plugin: 'context-band',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}
const USAGE = { value: { startedAt: 0, rateLimits: [], context: { tokens: 120000, window: 200000, percent: 60 } } }

describe('context band', () => {
  test('footer shows the percentage; the menu compacts', async ($, on) => {
    let compacted = 0
    on('session.usage', () => USAGE)
    on('session.compact', () => {
      compacted += 1
      return { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const footer = await $.ui.mount({ ...FOOTER, surface })
      expect(await footer.find({ type: 'Text', text: /60%/ })).toBeDefined()
      await footer.press({ key: 'menu' })
      await footer.unmount()
      const menu = await $.ui.mount({ ...MENU, surface })
      await menu.select({ key: 'actions', value: 'compact' })
      await menu.unmount()
    }
    expect(compacted).toBe(2)
  })

  test('footer draws the engine line while no reading exists', async ($, on) => {
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 200000 } } }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect(await ui.find({ key: 'menu' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await ui.unmount()
  })
})
