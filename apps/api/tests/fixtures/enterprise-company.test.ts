import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertCompleteOrganizationFixture, enterpriseCompanyFixture } from './enterprise-company.ts'

void test('enterprise acceptance fixture contains a complete company tree', () => {
  assert.doesNotThrow(assertCompleteOrganizationFixture)
  assert.equal(enterpriseCompanyFixture.organizations.length, 3)
  assert.equal(enterpriseCompanyFixture.organizations.reduce((total, item) => total + item.departments.length, 0), 9)
  assert.equal(enterpriseCompanyFixture.users.some(user => !user.active), true)
  assert.equal(enterpriseCompanyFixture.invalidCases.duplicateExternalId.length, 2)
})
