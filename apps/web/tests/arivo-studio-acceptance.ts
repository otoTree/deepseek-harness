/** Normal product checks for Agent-created local scripts and shots; no storage writes from the driver. */
import { join } from 'node:path'
import { expect } from 'vitest'
import type { Page } from 'playwright'

export const creativeTitle = 'Harness 创作闭环验收'
export const creativeScript = '外景 · 星港 · 夜\n邮差把信递给船长。\n船长：明天出发。'

/** Create only the empty project through ordinary product controls.
 * @param page - Packaged OS page.
 * @param folder - Existing directory of the original Harness conversation.
 */
export async function prepareCreativeProject(page: Page, folder: string): Promise<void> {
  await page.getByRole('button', { name: 'Arivo 创作', exact: true }).and(page.locator('.arivo-rail-item')).click()
  const studio = page.frameLocator('iframe.arivo-pane:not(.arivo-workbench-pane)')
  await studio.getByTestId('create-project').click()
  await studio.getByLabel('项目名称', { exact: true }).fill(creativeTitle)
  await studio.getByRole('button', { name: '创建项目', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
  await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
  await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(folder)
  await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
  await picker.getByRole('button', { name: '打开', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await studio.getByRole('button', { name: '新建项目对话', exact: true }).waitFor()
  await page.getByRole('button', { name: '会话', exact: true }).click()
}

/** Ask the real Harness Agent to use the bundled plugin and wait for its normal final reply.
 * @param page - Packaged OS page with selected cloud model.
 * @param output - Evidence directory.
 */
export async function runCreativeTask(page: Page, output: string): Promise<void> {
  await page.locator('[contenteditable="true"]').fill(
    `Use only arivo_* tools. Find the local project titled ${JSON.stringify(creativeTitle)}. `
    + 'Create exactly one episode titled 星港来信, write its complete script with this exact content: '
    + JSON.stringify(creativeScript) + '. Save an immutable script version, then bind that version to its storyboard. '
    + 'Create exactly one shot titled 递信, durationMs 6000, sceneHeading 外景 星港 夜, dialogue 明天出发。, '
    + 'videoPrompt 夜晚星港，邮差递信给船长, shotSize 中景, cameraAngle 平视, cameraMovement 固定. '
    + 'Use current revisions returned by tools; read board revision first if needed. Do not use Bash, write or other file tools. '
    + 'Do not generate images or videos. After all tools succeed reply with exactly ARIVO_STUDIO_OK.',
  )
  expect(await page.getByRole('button', { name: '发送消息', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('ARIVO_STUDIO_OK', { exact: true }).last().waitFor({ timeout: 180000 })
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(output, 'creative-agent.png') })
  await verifyCreativeProduct(page, output)
}

/** Independently read the actual plugin's saved script and shot through its Workbench UI.
 * @param page - Packaged OS page.
 * @param output - Evidence directory.
 */
export async function verifyCreativeProduct(page: Page, output: string): Promise<void> {
  await page.getByRole('button', { name: '会话', exact: true }).click()
  const workbench = page.getByRole('button', { name: '工作台', exact: true })
  if (await workbench.getAttribute('aria-pressed') === 'false') await workbench.click()
  await page.locator('.arivo-workbench-open').click()
  const studio = page.frameLocator('iframe.arivo-workbench-pane')
  await studio.getByRole('heading', { name: creativeTitle, exact: true }).waitFor()
  await studio.getByRole('button', { name: '剧本', exact: true }).click()
  await expect.poll(() => studio.getByRole('textbox', { name: '剧本正文', exact: true }).inputValue()).toBe(creativeScript)
  await studio.getByRole('button', { name: '查看版本 1', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(output, 'creative-script-workbench.png') })
  await studio.getByRole('button', { name: '返回项目', exact: true }).click()
  await studio.getByRole('button', { name: '分镜', exact: true }).click()
  await studio.getByRole('heading', { name: '递信', exact: true }).waitFor()
  expect(await studio.locator('.studio-shot-preview').count()).toBe(1)
  await studio.getByText('新镜头使用剧本 V1', { exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(output, 'creative-shot-workbench.png') })
}
