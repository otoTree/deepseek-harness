// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { visibleTurnAtLine } from '../src/client/chat/visible-turn.ts'

describe('visible Turn lookup', () => {
  it('bounds geometry reads for a long transcript and ignores nested rows', () => {
    const column = document.createElement('div')
    let reads = 0
    for (let index = 0; index < 4_096; index++) {
      const row = document.createElement('div')
      row.dataset.chatTurn = String(index + 1)
      row.innerHTML = '<div data-chat-turn="99999"></div>'
      row.getBoundingClientRect = () => {
        reads++
        return new DOMRect(0, index * 20, 100, 10)
      }
      column.append(row)
    }
    expect(visibleTurnAtLine(column, 80_005, 1)).toBe(4_001)
    expect(reads).toBeLessThanOrEqual(13)
  })

  it('keeps the preceding Turn in gaps and before unmarked tail controls', () => {
    const column = document.createElement('div')
    for (const [index, turn] of [undefined, 2, 4, undefined].entries()) {
      const row = document.createElement('div')
      if (turn !== undefined) row.dataset.chatTurn = String(turn)
      row.getBoundingClientRect = () => new DOMRect(0, index * 20, 100, 10)
      column.append(row)
    }
    expect(visibleTurnAtLine(column, -1, 2)).toBe(2)
    expect(visibleTurnAtLine(column, 35, 2)).toBe(2)
    expect(visibleTurnAtLine(column, 70, 2)).toBe(4)
  })

  it('uses the last ordered zero-height Seat at a shared position', () => {
    const column = document.createElement('div')
    for (const turn of [1, 2, 3]) {
      const row = document.createElement('div')
      row.dataset.chatTurn = String(turn)
      row.getBoundingClientRect = () => new DOMRect(0, 20, 100, 0)
      column.append(row)
    }
    expect(visibleTurnAtLine(column, 20, 1)).toBe(3)
  })
})
