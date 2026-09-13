/** Enterprise desktop browser entry built and shipped by the Electrobun application. */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

const root = document.getElementById('root')
if (root === null) throw new Error('enterprise desktop: missing #root')
void new AppWebEntry(root).run()
