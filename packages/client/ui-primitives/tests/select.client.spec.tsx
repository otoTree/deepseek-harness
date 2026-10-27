// @vitest-environment jsdom
/** Product dropdowns retain native forms while exposing keyboard-selectable options. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Select } from '../src/Select.tsx'
import { Modal } from '../src/Modal.tsx'
import { TabGroup } from '../src/TabGroup.tsx'

afterEach(cleanup)

it('selects by keyboard, skips disabled options and submits the native value', () => {
  const changed = vi.fn()
  const view = render(<form><label>Region<Select name="region" defaultValue="one" onChange={(event) => { changed(event.currentTarget.value) }}>
    <option value="one">One</option><option value="disabled" disabled>Unavailable</option><option value="two">Two</option>
  </Select></label></form>)
  const field = screen.getByRole('combobox', { name: 'Region' })
  field.focus()
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  expect(screen.getByRole('option', { name: 'Two' }).getAttribute('data-active')).toBe('true')
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(changed).toHaveBeenCalledWith('two')
  expect(new FormData(view.container.querySelector('form')!).get('region')).toBe('two')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(document.activeElement).toBe(field)
  fireEvent.reset(view.container.querySelector('form')!)
  expect(field.textContent).toBe('One')
})

it('keeps controlled choices, closes on Escape/outside pointer, and focuses an invalid field', () => {
  const view = render(<label>Model<Select value="" required><option value="">Choose</option><option value="model">Model A</option></Select></label>)
  const field = screen.getByRole('combobox', { name: 'Model' })
  fireEvent.click(field)
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.click(field)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.invalid(view.container.querySelector('select')!)
  expect(field.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(field)
  view.rerender(<label>Model<Select value="model" required><option value="">Choose</option><option value="model">Model A</option></Select></label>)
  expect(field.textContent).toBe('Model A')
})

it('keeps inactive form drafts and uses arrow/Home/End navigation between tabs', () => {
  render(<TabGroup label="Settings" tabs={[
    { id: 'one', label: 'Basics', content: <input aria-label="Draft" defaultValue="initial" /> },
    { id: 'two', label: 'Advanced', content: <p>Other settings</p> },
  ]} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'keep me' } })
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Basics' }), { key: 'End' })
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Advanced' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Advanced' }), { key: 'ArrowRight' })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Draft' }).value).toBe('keep me')
})

it('focuses the visible dropdown in a modal and keeps the dialog open when dismissing its list', () => {
  const closed = vi.fn()
  render(<Modal open title="Form" closeLabel="Close" onClose={closed}>
    <label>Choice<Select name="choice"><option value="one">One</option><option value="two">Two</option></Select></label>
  </Modal>)
  const field = screen.getByRole('combobox', { name: 'Choice' })
  expect(document.activeElement).toBe(field)
  fireEvent.keyDown(field, { key: 'End' })
  expect(screen.getByRole('option', { name: 'Two' }).getAttribute('data-active')).toBe('true')
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(closed).not.toHaveBeenCalled()
  expect(screen.queryByRole('listbox')).toBeNull()
})
