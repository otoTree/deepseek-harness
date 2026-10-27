/** Ordered outer-row lookup for approximate active-Turn highlighting. */

/**
 * Locate the Turn at a viewport line without hit testing or traversing row contents.
 * @param column - natural-flow Chat column whose empty Seats retain zero-height boxes.
 * @param line - viewport y coordinate of the reading line.
 * @param firstTurn - fallback before the first loaded Turn.
 * @returns the preceding row's Turn, or the fallback when no Turn precedes the line.
 */
export function visibleTurnAtLine(column: HTMLElement, line: number, firstTurn: number): number {
  const rows = column.children
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((rows[middle] as Element).getBoundingClientRect().top > line) high = middle
    else low = middle + 1
  }
  // Loading, paging, and pending-input controls have no Turn marker.
  for (let index = low - 1; index >= 0; index--) {
    const value = (rows[index] as Element).getAttribute('data-chat-turn')
    const turn = value === null ? NaN : Number(value)
    if (Number.isSafeInteger(turn)) {
      const segment = rows[index] as HTMLElement
      const flow = segment.hasAttribute('data-chat-chunk')
        ? segment.querySelector<HTMLElement>('[data-chat-flow]:not([hidden])')
        : null
      return flow === null ? turn : visibleTurnAtLine(flow, line, turn)
    }
  }
  return firstTurn
}
