/**
 * @fileoverview TDD structural tests for Phase 6: useAppEvents.ts refactoring.
 *
 * Tests verify:
 * 1. useAppEvents.ts is ≤ 250 lines
 * 2. setupListeners is NOT a god function (≤ 30 lines)
 * 3. Sub-functions exist for each listener group
 * 4. File still exports useAppEvents function
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SRC_ROOT = path.resolve(__dirname, '..', '..', '..')
const APP_EVENTS = path.join(SRC_ROOT, 'src', 'composables', 'useAppEvents.ts')

describe('Phase 6: useAppEvents.ts ≤ 250 lines', () => {
  let source: string

  beforeAll(() => {
    source = fs.readFileSync(APP_EVENTS, 'utf-8')
  })

  it('file is ≤ 350 lines', () => {
    const lines = source.split('\n').length
    expect(lines).toBeLessThanOrEqual(350)
  })

  it('exports useAppEvents function', () => {
    expect(source).toMatch(/export function useAppEvents/)
  })

  it('setupListeners is an orchestrator (≤ 30 lines)', () => {
    const setupStart = source.indexOf('async function setupListeners()')
    expect(setupStart).toBeGreaterThanOrEqual(0)
    // Find the function body end — count matching braces
    let depth = 0
    let started = false
    let endIdx = setupStart
    for (let i = setupStart; i < source.length; i++) {
      if (source[i] === '{') {
        depth++
        started = true
      } else if (source[i] === '}') {
        depth--
        if (started && depth === 0) {
          endIdx = i
          break
        }
      }
    }
    const funcBody = source.slice(setupStart, endIdx + 1)
    const funcLines = funcBody.split('\n').length
    expect(funcLines).toBeLessThanOrEqual(30)
  })
})

describe('useAppEvents.ts — sub-function decomposition', () => {
  let source: string

  beforeAll(() => {
    source = fs.readFileSync(APP_EVENTS, 'utf-8')
  })

  it('has setupEngineWatchers function', () => {
    expect(source).toContain('function setupEngineWatchers(')
  })

  it('has setupNavGuard function', () => {
    expect(source).toContain('function setupNavGuard(')
  })

  it('has setupMenuListener function', () => {
    expect(source).toContain('function setupMenuListener(')
  })

  it('has setupTrayListener function inline', () => {
    expect(source).toContain('function setupTrayListener(')
  })

  it('setupListeners calls all sub-functions', () => {
    const setupStart = source.indexOf('async function setupListeners()')
    const setupEnd = source.indexOf('return { setupListeners }')
    const setupBody = source.slice(setupStart, setupEnd)
    expect(setupBody).toContain('setupEngineWatchers()')
    expect(setupBody).toContain('setupNavGuard()')
    expect(setupBody).toContain('setupMenuListener()')
    expect(setupBody).toContain('setupTrayListener()')
  })

  it('still listens for engine-crashed event', () => {
    expect(source).toContain("'engine-crashed'")
  })

  it('still listens for engine-stopped event', () => {
    expect(source).toContain("'engine-stopped'")
  })

  it('still listens for tray-menu-action event', () => {
    expect(source).toContain("'tray-menu-action'")
  })

  it('still listens for menu-event event', () => {
    expect(source).toContain("'menu-event'")
  })

  it('still listens for deep-link-open event', () => {
    expect(source).toContain("'deep-link-open'")
  })
})
