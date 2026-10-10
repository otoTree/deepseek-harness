import { expect, it } from 'vitest'
import { parseEnterpriseStartArgs } from './enterprise-start.ts'

it('starts without the desktop client unless --desktop is present', () => {
  expect(parseEnterpriseStartArgs([])).toEqual({ withDesktop: false })
  expect(parseEnterpriseStartArgs(['--', '--desktop'])).toEqual({ withDesktop: true })
})

it('rejects misspelled or unsupported launcher arguments', () => {
  expect(() => parseEnterpriseStartArgs(['--desktopOOK'])).toThrow(
    'Unknown enterprise:start argument(s): --desktopOOK. Use --desktop to start the desktop client.',
  )
})
