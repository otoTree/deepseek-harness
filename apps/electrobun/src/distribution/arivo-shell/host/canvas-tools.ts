/** Canvas tool descriptions and requests use the same scoped native handle as script tools. */
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { ArivoStudioToolRegistrar } from './studio-tools.ts'

/** Register local graph operations without model dispatch, asset-result submission or task writes.
 * @param add - Original Harness registry adapter with Session-derived command identities.
 */
export function registerCanvasTools(add: ArivoStudioToolRegistrar): void {
  const id: JsonSchemaNode = { type: 'string', description: 'Exact local UUID returned by Arivo tools, never a cloud ID.' }
  const version: JsonSchemaNode = { type: 'integer', description: 'Exact canvas runtimeVersion from the last read. Reread on conflict; never guess.' }
  const project = { projectId: id }, target = { ...project, canvasId: id }
  const mutation = { ...target, baseRuntimeVersion: version }
  const content = {
    title: { type: 'string', description: 'Nonempty title, at most 255 characters.' },
    promptInput: { type: 'string', description: 'Complete node prompt, at most 10000 characters. Read existing content before replacing it.' },
  } satisfies Record<string, JsonSchemaNode>
  const read = (action: string) => (args: Record<string, unknown>) => ({ type: 'canvas', input: { action, ...args } })
  const write = (action: string) => (args: Record<string, unknown>, mutationId: string) => ({ type: 'canvas', input: { action, ...args, mutationId } })
  add('arivo_list_canvases', 'List canvases in this conversation’s project folder. Follow nextCursor using after. No model calls or credits.',
    { ...project, after: id }, ['projectId'], read('list'))
  add('arivo_read_canvas', 'Read the canvas runtimeVersion, counts and undo/redo availability before editing. Local graph changes do not generate media.',
    target, ['projectId', 'canvasId'], read('manifest'))
  add('arivo_read_canvas_page', 'Read a bounded page of lightweight nodes or edges at one runtimeVersion. Follow nextCursor using after and the same version.',
    { ...target, runtimeVersion: version, kind: { type: 'string', enum: ['nodes', 'edges'] }, after: id },
    ['projectId', 'canvasId', 'runtimeVersion', 'kind'], read('page'))
  add('arivo_read_canvas_node', 'Read one exact canvas node, including its prompt and fixed asset references, at the current runtimeVersion.',
    { ...target, runtimeVersion: version, nodeId: id }, ['projectId', 'canvasId', 'runtimeVersion', 'nodeId'], read('node'))
  add('arivo_create_canvas', 'Create a canvas in this conversation’s existing project folder. Returns the real canvas ID; does not create a project or call models.',
    { ...project, title: content.title }, ['projectId', 'title'], write('create'), true)
  add('arivo_create_canvas_node', 'Add a text, image, video, audio or visual-storyboard node at an exact canvas version. Creates content only; generate media explicitly in the creative workspace.',
    { ...mutation, ...content, nodeType: { type: 'string', enum: ['text', 'image', 'video', 'audio', 'visual_storyboard'] },
      positionX: { type: 'number' }, positionY: { type: 'number' } },
    ['projectId', 'canvasId', 'baseRuntimeVersion', 'nodeType', 'title', 'promptInput', 'positionX', 'positionY'], write('createNode'), true)
  add('arivo_edit_canvas_node', 'Replace a node title and complete prompt at an exact version. Read the node first. Keeps fixed assets and model results; conflicts refuse newer edits.',
    { ...mutation, ...content, nodeId: id }, ['projectId', 'canvasId', 'baseRuntimeVersion', 'nodeId', 'title', 'promptInput'], write('editNode'), true)
  add('arivo_connect_canvas_nodes', 'Connect two existing nodes at an exact version. The Worker determines connection semantics and rejects cycles and duplicate edges.',
    { ...mutation, sourceNodeId: id, targetNodeId: id }, ['projectId', 'canvasId', 'baseRuntimeVersion', 'sourceNodeId', 'targetNodeId'], write('connect'), true)
  add('arivo_canvas_history', 'Undo or redo the most recent canvas graph change at the current version. Reread the canvas first; this never cancels cloud tasks or refunds credits.',
    { ...mutation, direction: { type: 'string', enum: ['undo', 'redo'] } }, ['projectId', 'canvasId', 'baseRuntimeVersion', 'direction'], write('history'), true)
}
