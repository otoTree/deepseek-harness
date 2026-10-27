/** Deferred transcript segments retain natural geometry after their first mount. */
import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ComponentProps, type MutableRefObject,
} from 'react'
import { flushSync } from 'react-dom'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import type { ChatHistoryLayout, ChatHistoryMeasurement } from '../contract/store.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import css from './ChatView.module.css'

interface DeferredRange {
  readonly from: number
  readonly to: number
  readonly offsets: readonly number[]
}

interface Segment {
  readonly key: string
  readonly order: string[]
  readonly turns: Set<number>
}

/** View-local navigation into a deferred segment. */
export interface HistoryReveal {
  /**
   * Request the segment owning an anchor.
   * @param key - stable row identity.
   * @returns whether its renderer is already mounted.
   */
  reveal(key: string): boolean
}

type Props = Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey' | 'isLatestHuman'> & {
  readonly order: readonly string[]
  readonly nodes: ChatSnapshot['nodes']
  readonly latestHumanKey: string | undefined
  readonly rendering: ChatViewSlotProps['historyRendering']
  readonly savedAnchor: string | undefined
  readonly layout: ChatHistoryLayout | null
  readonly rememberLayout: (layout: ChatHistoryLayout) => void
  readonly revealRef: MutableRefObject<HistoryReveal | null>
  readonly onGeometryChange: (compensation: number) => void
}

function segmentsOf(order: readonly string[], nodes: ChatSnapshot['nodes'], size: number, membership: Map<string, string>): Segment[] {
  const segments: Segment[] = []
  const located = order.map(key => nodes.get(key)?.location).find(location => location?.kind === 'turn' || location?.kind === 'step')
  const firstTurn = located?.kind === 'turn' || located?.kind === 'step' ? located.turn.turn : undefined
  let preceding = firstTurn === undefined ? `session:${order[0] ?? ''}` : `turns:${Math.floor((firstTurn - 1) / size)}`
  const occurrences = new Map<string, number>()
  for (const key of order) {
    const location = nodes.get(key)?.location
    const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
    const bucket = turn === undefined ? preceding : `turns:${Math.floor((turn - 1) / size)}`
    preceding = bucket
    let segmentKey = membership.get(key) ?? bucket
    let segment = segments.at(-1)
    if (segment?.key !== segmentKey) {
      const occurrence = occurrences.get(segmentKey) ?? 0
      occurrences.set(segmentKey, occurrence + 1)
      if (occurrence > 0) segmentKey = `${segmentKey}:part${occurrence}`
      segment = { key: segmentKey, order: [], turns: new Set() }
      segments.push(segment)
    }
    membership.set(key, segmentKey)
    segment.order.push(key)
    if (turn !== undefined) segment.turns.add(turn)
  }
  return segments
}

/** Text leaves retain model/tool content without indexing JSON property names. */
function searchText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return ''
  return Object.values(value).map(searchText).filter(Boolean).join('\n')
}

function searchableSegment(segment: Segment, nodes: ChatSnapshot['nodes']): string {
  return segment.order.map((key) => {
    const node = nodes.get(key)
    // Footer metadata repeats the closing answer; the process control has only counters.
    return node === undefined || node.kind === 'turn-tail' || node.kind === 'turn-process'
      ? ''
      : searchText(node.data)
  }).filter(Boolean).join('\n')
}

function ownsAnchor(segment: Segment, key: string, layout: ChatHistoryLayout | null): boolean {
  return segment.order.includes(key) || (layout?.segments[segment.key]?.anchors.includes(key) ?? false)
}

/**
 * Mount the reading neighborhood first and retain every visited segment until the view unmounts.
 * @param props - node sources, saved geometry, and view-local reveal control.
 * @returns natural-flow transcript segments with searchable deferred content.
 */
export const LazyChatHistory = memo(function LazyChatHistory({
  order, nodes, latestHumanKey, rendering, savedAnchor, layout, rememberLayout, revealRef,
  onGeometryChange, ...seatProps
}: Props) {
  const membership = useRef(new Map<string, string>())
  const segments = useMemo(
    () => segmentsOf(order, nodes, rendering.historySegmentTurns, membership.current),
    [order, nodes, rendering.historySegmentTurns],
  )
  const searchIndex = useMemo(() => new Map<string, string>(), [segments, nodes])
  const [, refreshSearchIndex] = useState(0)
  const hasSegments = segments.length > 0
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => {
    if (typeof IntersectionObserver === 'undefined') return new Set(segments.map(segment => segment.key))
    const savedIndex = savedAnchor === undefined ? -1 : segments.findIndex(segment => ownsAnchor(segment, savedAnchor, layout))
    const end = savedIndex < 0 ? segments.length : Math.min(segments.length, savedIndex + 1)
    const start = Math.max(0, end - rendering.historyInitialSegments)
    return new Set(segments.slice(start, end).map(segment => segment.key))
  })
  const [allMounted, setAllMounted] = useState(() => typeof IntersectionObserver === 'undefined')
  const elements = useRef(new Map<string, HTMLDivElement>())
  const measured = useRef<Record<string, ChatHistoryMeasurement>>({ ...layout?.segments })
  const anchor = useRef<{ element: HTMLElement | null; key: string; top: number } | null>(null)
  const ranges = useRef(new Map<string, DeferredRange>())
  const scrollport = useRef<HTMLElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const sizeObserverRef = useRef<ResizeObserver | null>(null)
  const latest = useRef({ segments, mounted, allMounted, onGeometryChange, rememberLayout })
  latest.current = { segments, mounted, allMounted, onGeometryChange, rememberLayout }

  const captureAnchor = useCallback(() => {
    const port = scrollport.current
    if (port === null || port.scrollHeight - port.scrollTop - port.clientHeight <= 1) return
    const top = port.getBoundingClientRect().top
    const first = elements.current.values().next().value
    const column = first?.closest('[data-chat-loaded-turns]')
    if (column === null || column === undefined) return
    for (const element of column.querySelectorAll<HTMLElement>('[data-chat-chunk]')) {
      const box = element.getBoundingClientRect()
      if (box.bottom <= top) continue
      const key = element.dataset.chatChunk as string
      const range = ranges.current.get(key)
      if (range === undefined) {
        const row = element.querySelector<HTMLElement>('[data-chat-anchor-key]:not([hidden])') ?? element
        anchor.current = { element: row, key, top: row.getBoundingClientRect().top }
      } else {
        let index = 0
        while (index + 1 < range.offsets.length - 1 && box.top + (range.offsets[index + 1] as number) <= top) index++
        const segment = latest.current.segments[range.from + index]
        if (segment !== undefined) {
          anchor.current = { element: null, key: segment.key, top: box.top + (range.offsets[index] as number) }
        }
      }
      break
    }
  }, [])

  const mountSegments = useCallback((keys: readonly string[]) => {
    const state = latest.current
    if (state.allMounted || keys.every(key => state.mounted.has(key))) return
    captureAnchor()
    setMounted(current => new Set([...current, ...keys]))
  }, [captureAnchor])

  useLayoutEffect(() => {
    if (mounted.size !== 0 || segments.length === 0) return
    if (typeof IntersectionObserver === 'undefined') {
      mountSegments(segments.map(segment => segment.key))
      return
    }
    const savedIndex = savedAnchor === undefined ? -1 : segments.findIndex(segment => ownsAnchor(segment, savedAnchor, layout))
    const end = savedIndex < 0 ? segments.length : savedIndex + 1
    mountSegments(segments.slice(Math.max(0, end - rendering.historyInitialSegments), end).map(segment => segment.key))
  }, [segments, mounted, savedAnchor, layout, rendering.historyInitialSegments, mountSegments])

  const tailKey = segments.at(-1)?.key
  useLayoutEffect(() => {
    if (tailKey !== undefined) mountSegments([tailKey])
  }, [tailKey, mountSegments])

  revealRef.current = {
    reveal: (key) => {
      const segment = segments.find(candidate => ownsAnchor(candidate, key, layout))
      if (segment === undefined) return false
      if (allMounted || mounted.has(segment.key)) return true
      mountSegments([segment.key])
      return false
    },
  }

  useLayoutEffect(() => {
    const held = anchor.current
    anchor.current = null
    let compensation = 0
    const heldElement = held?.element?.isConnected === true ? held.element : held === null ? undefined : elements.current.get(held.key)
    if (held !== null && heldElement !== undefined && scrollport.current !== null) {
      const port = scrollport.current
      const before = port.scrollTop
      port.scrollTop += heldElement.getBoundingClientRect().top - held.top
      compensation = port.scrollTop - before
    }
    latest.current.onGeometryChange(compensation)
  }, [mounted, allMounted])

  useEffect(() => {
    const first = elements.current.values().next().value
    if (first === undefined) return
    const port = first.closest<HTMLElement>('[data-conversation-scroll]')
      ?? first.closest<HTMLElement>('[data-chat-scroll]')
    if (port === null) return
    scrollport.current = port
    if (typeof IntersectionObserver === 'undefined') return
    const revealVisible = (elements: Iterable<HTMLElement>, intersecting = false): void => {
      const keys: string[] = []
      const viewport = port.getBoundingClientRect()
      const overscan = port.clientHeight * rendering.historyOverscanViewports
      for (const element of elements) {
        const key = element.dataset.chatChunk as string
        const range = ranges.current.get(key)
        if (range === undefined) continue
        const box = element.getBoundingClientRect()
        if (!intersecting && (box.bottom <= viewport.top - overscan || box.top >= viewport.bottom + overscan)) continue
        let low = 0
        let high = range.offsets.length - 1
        while (low < high) {
          const middle = (low + high) >>> 1
          if (box.top + (range.offsets[middle + 1] as number) > viewport.top - overscan) high = middle
          else low = middle + 1
        }
        for (let index = low; index < range.to - range.from; index++) {
          if (index > low && box.top + (range.offsets[index] as number) >= viewport.bottom + overscan) break
          const segment = latest.current.segments[range.from + index]
          if (segment !== undefined) keys.push(segment.key)
        }
      }
      if (keys.length > 0) flushSync(() => { mountSegments(keys) })
    }
    const observer = new IntersectionObserver((entries) => {
      revealVisible(entries.filter(entry => entry.isIntersecting).map(entry => entry.target as HTMLElement), true)
    }, { root: port, rootMargin: `${port.clientHeight * rendering.historyOverscanViewports}px 0px` })
    observerRef.current = observer
    for (const [key, element] of elements.current) {
      if (!latest.current.mounted.has(key)) observer.observe(element)
    }
    // Scrolling inside one tall placeholder need not cross an intersection threshold.
    let frame: number | undefined
    const onScroll = (): void => {
      frame ??= requestAnimationFrame(() => {
        frame = undefined
        revealVisible(elements.current.values())
      })
    }
    port.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      observerRef.current = null
      port.removeEventListener('scroll', onScroll)
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [hasSegments, mountSegments, rendering.historyOverscanViewports])

  useLayoutEffect(() => {
    const measure = (element: HTMLElement, height: number): void => {
      const key = element.dataset.chatChunk
      if (key === undefined || element.hasAttribute('data-chat-deferred')) return
      measured.current[key] = {
        height,
        anchors: Array.from(element.querySelectorAll<HTMLElement>('[data-chat-anchor-key]'), row => row.dataset.chatAnchorKey as string),
      }
    }
    // All deferred children are hidden before these geometry reads.
    for (const element of elements.current.values()) measure(element, element.getBoundingClientRect().height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.target as HTMLElement, entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
    })
    sizeObserverRef.current = observer
    for (const element of elements.current.values()) observer.observe(element)
    return () => { observer.disconnect(); sizeObserverRef.current = null }
  }, [hasSegments])

  // Search text is prepared in idle slices; rich content and input do not wait for it.
  useEffect(() => {
    if (allMounted) return
    let index = 0
    let scheduled: number | undefined
    const idle = typeof window.requestIdleCallback === 'function'
    const schedule = (): void => {
      scheduled = idle ? window.requestIdleCallback(fill) : window.setTimeout(() => { fill() })
    }
    const fill = (deadline?: IdleDeadline): void => {
      do {
        const segment = segments[index++]
        if (segment === undefined) break
        if (!latest.current.mounted.has(segment.key)) searchIndex.set(segment.key, searchableSegment(segment, nodes))
      } while (index < segments.length && deadline !== undefined && deadline.timeRemaining() > 0)
      if (index < segments.length) schedule()
      else refreshSearchIndex(value => value + 1)
    }
    schedule()
    return () => {
      if (scheduled === undefined) return
      if (idle) window.cancelIdleCallback(scheduled)
      else window.clearTimeout(scheduled)
    }
  }, [segments, nodes, allMounted, searchIndex])

  // Native Select All and Find operate on the complete loaded rich transcript.
  // Menu-driven browser find can reveal one searchable segment through beforematch.
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !['a', 'f'].includes(event.key.toLowerCase())) return
      const target = event.target
      if (event.key.toLowerCase() === 'a' && target instanceof HTMLElement
        && target.closest('input, textarea, [contenteditable="true"]') !== null) return
      captureAnchor()
      flushSync(() => { setAllMounted(true) })
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true) }
  }, [captureAnchor])

  useLayoutEffect(() => () => {
    const current: Record<string, ChatHistoryMeasurement> = {}
    for (const segment of latest.current.segments) {
      const measurement = measured.current[segment.key]
      if (measurement !== undefined) current[segment.key] = measurement
    }
    latest.current.rememberLayout({ viewportWidth: window.innerWidth, segments: current })
  }, [])

  const currentWidth = window.innerWidth
  // Segment spacing matches the fixed outer-row rhythm in ChatView.module.css.
  const gap = 20
  const rangesNext = new Map<string, DeferredRange>()
  const output: React.ReactNode[] = []
  for (let index = 0; index < segments.length;) {
    const segment = segments[index] as Segment
    const live = allMounted || mounted.has(segment.key) || index === segments.length - 1
    let rendered = segment
    let height = 0
    let text = ''
    let revealKeys = [segment.key]
    if (!live) {
      const from = index
      const offsets = [0]
      const texts: string[] = []
      revealKeys = []
      while (index < segments.length - 1) {
        const candidate = segments[index] as Segment
        if (mounted.has(candidate.key)) break
        const measurement = layout?.viewportWidth === currentWidth ? measured.current[candidate.key] : undefined
        const estimate = measurement?.height ?? Math.max(1, candidate.turns.size) * rendering.historyEstimatedTurnHeight
        height += (index === from ? 0 : gap) + estimate
        offsets.push(height + gap)
        texts.push(searchIndex.get(candidate.key) ?? '')
        revealKeys.push(candidate.key)
        index++
      }
      const key = segment.key
      rendered = { key, order: [], turns: segment.turns }
      rangesNext.set(key, { from, to: index, offsets })
      text = texts.join('\n')
    } else index++
    const elementKey = rendered.key
    output.push(
      <HistorySegment
        key={elementKey}
        segment={rendered}
        live={live}
        height={height}
        text={text}
        register={(element) => {
          if (element === null) {
            const previous = elements.current.get(elementKey)
            if (previous !== undefined) {
              observerRef.current?.unobserve(previous)
              sizeObserverRef.current?.unobserve(previous)
            }
            elements.current.delete(elementKey)
            return
          }
          elements.current.set(elementKey, element)
          if (!live) observerRef.current?.observe(element)
          else sizeObserverRef.current?.observe(element)
        }}
        reveal={() => { flushSync(() => { mountSegments(revealKeys) }) }}
      >
        {live && segment.order.map(nodeKey => (
          <ChatNodeSeat key={nodeKey} nodeKey={nodeKey} isLatestHuman={nodeKey === latestHumanKey} {...seatProps} />
        ))}
      </HistorySegment>,
    )
  }
  ranges.current = rangesNext
  return output

})

function HistorySegment({ segment, live, height, text, register, reveal, children }: {
  segment: Segment
  live: boolean
  height: number
  text: string
  register: (element: HTMLDivElement | null) => void
  reveal: () => void
  children: React.ReactNode
}) {
  const content = useRef<HTMLDivElement>(null)
  const latest = useRef({ reveal })
  latest.current = { reveal }
  useLayoutEffect(() => {
    const element = content.current
    if (live) element?.removeAttribute('hidden')
    else element?.setAttribute('hidden', 'until-found')
  }, [live])
  useEffect(() => {
    const element = content.current
    if (element === null) return
    const onMatch = (): void => { latest.current.reveal() }
    element.addEventListener('beforematch', onMatch)
    return () => { element.removeEventListener('beforematch', onMatch) }
  }, [])
  return (
    <div
      ref={register}
      className={css.historySegment}
      data-chat-chunk={segment.key}
      data-chat-turn={segment.turns.values().next().value}
      data-chat-deferred={!live || undefined}
      style={live ? undefined : { height }}
    >
      <div ref={content} className={css.segmentFlow} data-chat-flow="">
        {live ? children : text}
      </div>
    </div>
  )
}
