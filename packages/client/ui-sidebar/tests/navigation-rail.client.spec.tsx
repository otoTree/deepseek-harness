// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavigationRail as Rail } from '../src/client/NavigationRail.tsx'
import { GlobalTopbar } from '../src/client/GlobalTopbar.tsx'
import { en } from '../src/client/locales.ts'

const unusedHook = (() => { throw new Error('unused hook') }) as never
afterEach(cleanup)

it('shows session controls only on the conversation page', () => {
  const renderSession = vi.fn(() => <button>Session controls</button>)
  const props = {
    productTitle: 'Product', sessionTitle: 'Selected session', sidebarOpen: true,
    workbenchOpen: false, toggleSidebar: vi.fn(), toggleWorkbench: vi.fn(), renderSession,
    useSessions: unusedHook, useSessionPendingInteraction: unusedHook, useWorkspaces: unusedHook,
    t: (key: string) => key,
  }
  const view = render(<GlobalTopbar {...props} conversationActive />)
  expect(screen.getByText('Selected session')).toBeTruthy()
  expect(screen.getAllByRole('button')).toHaveLength(3)
  renderSession.mockClear()
  view.rerender(<GlobalTopbar {...props} conversationActive={false} />)
  expect(screen.getByText('Product')).toBeTruthy()
  expect(screen.queryByText('Selected session')).toBeNull()
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(renderSession).not.toHaveBeenCalled()
})

describe('NavigationRail', () => {
  it('renders the settings seat once at the bottom of the permanent rail', () => {
    render(<Rail
      active="conversation"
      navigate={() => {}}
      navigation={{ get: () => 'conversation', subscribe: () => () => {} } as never}
      useSessions={unusedHook}
      useSessionPendingInteraction={unusedHook}
      useWorkspaces={unusedHook}
      renderSlot={key => key === 'sidebar.settings'
        ? <button type="button" aria-label="Settings">Settings</button>
        : null}
      t={key => en[key as keyof typeof en]}
    />)

    expect(screen.getByRole('button', { name: 'Sessions' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1)
  })

  it('supplies a default icon to rail registrations', () => {
    let owner: { defaultIcon: (props: { size?: number }) => ReactNode } | undefined
    render(<Rail
      active="conversation"
      navigate={() => {}}
      navigation={{ get: () => 'conversation', subscribe: () => () => {} } as never}
      useSessions={unusedHook}
      useSessionPendingInteraction={unusedHook}
      useWorkspaces={unusedHook}
      renderSlot={(key, nextOwner) => {
        if (key === 'sidebar.rail.item') owner = nextOwner as typeof owner
        return null
      }}
      t={key => en[key as keyof typeof en]}
    />)

    expect(owner?.defaultIcon({ size: 18 })).toBeTruthy()
  })
})
