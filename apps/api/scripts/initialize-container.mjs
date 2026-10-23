/** Run compiled database initialization before the container starts its dsh profile. */
import { initializeEnterprise } from '../lib/initialize.js'

const result = await initializeEnterprise(process.env)
console.log(result === 'created' ? 'Enterprise deployment initialized.' : 'Enterprise database upgraded; existing deployment preserved.')
