// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NavigationRail as Rail } from '../src/client/NavigationRail.tsx'
import { en } from '../src/client/locales.ts'

const unusedHook = (() => { throw new Error('unused hook') }) as never

describe('NavigationRail', () => {
  it('renders the settings seat once at the bottom of the permanent rail', () => {
    render(<Rail
      active="conversation"
      navigate={() => {}}
      navigation={{ get: () => 'conversation', subscribe: () => () => {} } as never}
      useSessions={unusedHook}
      useSessionPendingInteraction={unusedHook}
      useWorkspaces={unusedHook}
      renderSlot={(key) => key === 'sidebar.settings'
        ? <button type="button" aria-label="Settings">Settings</button>
        : null}
      t={key => en[key as keyof typeof en]}
    />)

    expect(screen.getByRole('button', { name: 'Sessions' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1)
  })
})
