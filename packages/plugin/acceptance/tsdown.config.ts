import { clientBundle } from '../../client/tsdown.client.ts'

/** Build the acceptance fixture's shared, Host, and Client entry points. */
export default clientBundle('@deepseek-ai/dsh-plugin-acceptance', ['lib/types/index.js', 'lib/types/host.js'])
