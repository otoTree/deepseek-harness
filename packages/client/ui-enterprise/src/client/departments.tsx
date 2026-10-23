/* oxlint-disable @stylistic/max-len -- Department rows and modal fields keep localized controls together. */
/** Department management within the selected organization. */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseDepartments, EnterpriseTeam } from '../wire.ts'
import type { EnterpriseLocaleKey } from './locales.ts'

/** Host-owned department reads and mutations for the current organization. */
export interface DepartmentActions {
  /** Read the organization tree and current member assignments. */
  loadDepartments: () => Promise<EnterpriseDepartments>
  /** Create a department beneath the specified parent. */
  createDepartment: (name: string, parentId: string) => Promise<void>
  /** Rename or reparent a non-root department. */
  updateDepartment: (unitId: string, name: string, parentId: string) => Promise<void>
  /** Delete an empty non-root department. */
  deleteDepartment: (unitId: string) => Promise<void>
  /** Replace an active member's nonempty department selection. */
  setMemberDepartments: (membershipId: string, unitIds: string[]) => Promise<void>
}
type Unit = EnterpriseDepartments['units'][number]
type Member = EnterpriseTeam['members'][number]
type Editor = { kind: 'create' | 'edit' | 'delete'; unit: Unit } | { kind: 'member'; member: Member }
type Props = DepartmentActions & { members: Member[]; t: (key: EnterpriseLocaleKey) => string }

function unitPath(unit: Unit, units: Unit[]): string {
  return unitAncestors(unit, units).reverse().map(item => item.name).join(' / ')
}

function DepartmentEditor({ editor, data, close, saved, t, createDepartment, updateDepartment, deleteDepartment, setMemberDepartments }: DepartmentActions & {
  editor: Editor
  data: EnterpriseDepartments
  close: () => void
  saved: () => void
  t: Props['t']
}): ReactNode {
  const formId = useId()
  const [name, setName] = useState(editor.kind === 'member' ? '' : editor.kind === 'create' ? '' : editor.unit.name)
  const [parentId, setParentId] = useState(editor.kind === 'member' ? '' : editor.kind === 'create' ? editor.unit.id : editor.unit.parentId ?? '')
  const [unitIds, setUnitIds] = useState(editor.kind === 'member' ? data.assignments.filter(item => item.membershipId === editor.member.membershipId).map(item => item.unitId) : [])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const title = t(editor.kind === 'member' ? 'manageMemberDepartments' : editor.kind === 'create' ? 'createDepartment' : editor.kind === 'edit' ? 'editDepartment' : 'deleteDepartment')
  const valid = editor.kind === 'delete' || (editor.kind === 'member' ? unitIds.length > 0 : name.trim().length > 0 && name.trim().length <= 120 && parentId !== '')
  const parents = data.units.filter(unit => editor.kind !== 'edit' || !unitAncestors(unit, data.units).some(parent => parent.id === editor.unit.id))
  const submit = (): void => {
    setBusy(true); setFailed(false)
    const operation = editor.kind === 'member' ? setMemberDepartments(editor.member.membershipId, unitIds)
      : editor.kind === 'delete' ? deleteDepartment(editor.unit.id)
        : editor.kind === 'create' ? createDepartment(name.trim(), parentId) : updateDepartment(editor.unit.id, name.trim(), parentId)
    void operation.then(saved, () => { setBusy(false); setFailed(true) })
  }
  return <Modal open onClose={() => { if (!busy) close() }} title={title} closeLabel={t('closeDialog')} description={t(editor.kind === 'delete' ? 'departmentDeleteHelp' : editor.kind === 'member' ? 'memberDepartmentsHelp' : 'departmentHelp')} className="dse-settings-modal" footer={<><Button size="sm" variant="outline" disabled={busy} onClick={close}>{t('cancel')}</Button><Button size="sm" variant="primary" disabled={busy || !valid} type="submit" form={formId}>{t(editor.kind === 'delete' ? 'deleteDepartment' : 'save')}</Button></>}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); if (valid && !busy) submit() }}>
      <div className="dse-modal-fields">
        {editor.kind === 'member' ? <><strong>{editor.member.name || editor.member.email}</strong>{data.units.map(unit => <label key={unit.id}><input type="checkbox" checked={unitIds.includes(unit.id)} disabled={busy} onChange={(event) => { setUnitIds(event.currentTarget.checked ? [...unitIds, unit.id] : unitIds.filter(id => id !== unit.id)) }} /> {unitPath(unit, data.units)}</label>)}</> : editor.kind === 'delete' ? <p>{unitPath(editor.unit, data.units)}</p> : <>
          <label className="dse-modal-field"><span>{t('departmentName')}</span><input value={name} maxLength={120} disabled={busy} onChange={(event) => { setName(event.currentTarget.value) }} /></label>
          <label className="dse-modal-field"><span>{t('parentDepartment')}</span><select value={parentId} disabled={busy} onChange={(event) => { setParentId(event.currentTarget.value) }}>{parents.map(unit => <option key={unit.id} value={unit.id}>{unitPath(unit, data.units)}</option>)}</select></label>
        </>}
      </div>
      {failed ? <p className="dse-error" role="alert">{t('departmentRequestFailed')}</p> : null}
    </form>
  </Modal>
}

function unitAncestors(unit: Unit, units: Unit[]): Unit[] {
  const ancestors = [unit]
  let parentId = unit.parentId
  while (parentId !== null) {
    const parent = units.find(item => item.id === parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parentId
  }
  return ancestors
}

/** Render department hierarchy controls and member assignments.
 * @param props - Current-team members and organization-scoped Host callbacks.
 * @returns Department list and its active mutation dialog.
 */
export function Departments(props: Props): ReactNode {
  const { members, loadDepartments, t } = props
  const [data, setData] = useState<EnterpriseDepartments>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<Editor>()
  useEffect(() => {
    let current = true
    setFailed(false)
    void loadDepartments().then((value) => { if (current) setData(value) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [loadDepartments, revision])
  if (failed) return <div role="alert"><p>{t('requestFailed')}</p><Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  if (!data) return <p role="status">{t('loading')}</p>
  const units = [...data.units].sort((a, b) => unitPath(a, data.units).localeCompare(unitPath(b, data.units)))
  return <>
    <p className="dse-subtle">{t('departmentHelp')}</p>
    <ul className="dse-list">{units.map(unit => <li className="dse-row" key={unit.id}><span className="dse-row-main"><strong>{unitPath(unit, data.units)}</strong>{unit.parentId === null ? <span className="dse-row-note">{t('rootDepartment')}</span> : null}</span><div className="dse-department-actions"><Button size="sm" variant="outline" onClick={() => { setEditor({ kind: 'create', unit }) }}>{t('createDepartment')}</Button>{unit.parentId !== null ? <><Button size="sm" variant="outline" onClick={() => { setEditor({ kind: 'edit', unit }) }}>{t('editDepartment')}</Button><Button size="sm" variant="outline" onClick={() => { setEditor({ kind: 'delete', unit }) }}>{t('deleteDepartment')}</Button></> : null}</div></li>)}</ul>
    <h3>{t('departmentMembers')}</h3>
    <ul className="dse-list">{members.map(member => <li key={member.membershipId} className="dse-row"><span className="dse-row-main"><strong>{member.name || member.email}</strong><span className="dse-row-note">{units.filter(unit => data.assignments.some(item => item.membershipId === member.membershipId && item.unitId === unit.id)).map(unit => unitPath(unit, units)).join(', ')}</span></span>{member.status === 'active' ? <Button size="sm" variant="outline" onClick={() => { setEditor({ kind: 'member', member }) }}>{t('manageMemberDepartments')}</Button> : null}</li>)}</ul>
    {editor ? <DepartmentEditor {...props} editor={editor} data={data} close={() => { setEditor(undefined) }} saved={() => { setEditor(undefined); setRevision(value => value + 1) }} /> : null}
  </>
}
