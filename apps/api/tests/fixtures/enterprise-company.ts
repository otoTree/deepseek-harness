/** Deterministic fictional enterprise directory used by organization acceptance tests. */
export const enterpriseCompanyFixture = {
  root: { externalId: 'fixture:acme-group', name: 'Acme Group', kind: 'group' },
  organizations: [
    { externalId: 'fixture:acme-north', parentExternalId: 'fixture:acme-group', name: 'Acme North', departments: ['Engineering', 'Operations', 'Finance'] },
    { externalId: 'fixture:acme-south', parentExternalId: 'fixture:acme-group', name: 'Acme South', departments: ['Engineering', 'Sales', 'People'] },
    { externalId: 'fixture:acme-europe', parentExternalId: 'fixture:acme-group', name: 'Acme Europe', departments: ['Research', 'Support', 'Finance'] },
  ],
  users: [
    { externalId: 'fixture:user-ada', email: 'ada@example.invalid', name: 'Ada Chen', groupExternalIds: ['fixture:group-engineering', 'fixture:group-security'], active: true },
    { externalId: 'fixture:user-lin', email: 'lin@example.invalid', name: 'Lin Zhou', groupExternalIds: ['fixture:group-finance'], active: true },
    { externalId: 'fixture:user-morgan', email: 'morgan@example.invalid', name: 'Morgan Xu', groupExternalIds: ['fixture:group-sales'], active: false },
  ],
  groups: [
    { externalId: 'fixture:group-engineering', name: 'Engineering', organizationExternalId: 'fixture:acme-north' },
    { externalId: 'fixture:group-security', name: 'Security Reviewers', organizationExternalId: 'fixture:acme-north' },
    { externalId: 'fixture:group-finance', name: 'Finance Auditors', organizationExternalId: 'fixture:acme-europe' },
    { externalId: 'fixture:group-sales', name: 'Sales', organizationExternalId: 'fixture:acme-south' },
  ],
  invalidCases: {
    duplicateExternalId: ['fixture:acme-north', 'fixture:acme-north-duplicate'],
    orphanUser: 'fixture:user-with-missing-group',
    cycle: ['fixture:cycle-a', 'fixture:cycle-b'],
  },
} as const

/** Confirm the valid fixture has one root and every non-root organization resolves to it. */
export function assertCompleteOrganizationFixture(): void {
  const ids = new Set([enterpriseCompanyFixture.root.externalId, ...enterpriseCompanyFixture.organizations.map(item => item.externalId)])
  if (enterpriseCompanyFixture.organizations.some(item => !ids.has(item.parentExternalId))) throw new Error('Fixture contains an orphan organization')
  if (enterpriseCompanyFixture.organizations.filter(item => item.parentExternalId === enterpriseCompanyFixture.root.externalId).length !== 3) throw new Error('Fixture must contain three subsidiaries')
  if (enterpriseCompanyFixture.organizations.some(item => item.departments.length < 3)) throw new Error('Each subsidiary requires at least three departments')
}

assertCompleteOrganizationFixture()
