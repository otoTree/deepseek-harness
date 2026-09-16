/** Built gateway composition; the shared profile fixture owns process teardown. */
import { fileURLToPath } from 'node:url'
import type { TestContext } from 'node:test'
import type { z } from 'zod'
import type { Config } from '../src/gateway-provider.ts'
import { nativeProfile } from './native-profile.ts'

/** Exercise the native gateway through the supported dsh launcher.
 * @param t - Fixture resource owner.
 * @param config - Non-secret deployment and Keychain locator.
 * @param model - Authorized fixture model.
 * @returns Stream chunks serialized by the profile driver.
 */
export function gatewayProfile(t: TestContext, config: z.infer<typeof Config>, model: string): Promise<string> {
  return nativeProfile(t, {
    rows: [
      { id: 'llm', name: fileURLToPath(new URL('../../../packages/llm/llm/lib/index.js', import.meta.url)) },
      { id: 'llm-files', name: fileURLToPath(new URL('../../../packages/llm/llm-files/lib/index.js', import.meta.url)) },
      { id: 'enterprise', name: fileURLToPath(new URL('../lib/gateway-provider.js', import.meta.url)), config },
    ],
    driver: `export const inject = ['llm'];
export async function apply(ctx) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Enterprise provider did not register')), 10000);
    const check = () => {
      if (!ctx.llm.listProviders().some(provider => provider.id === 'enterprise')) return;
      clearTimeout(timer); dispose(); resolve();
    };
    const dispose = ctx.on('llm/adapters-updated', check);
    check();
  });
  const chunks = [];
  for await (const chunk of ctx.llm.stream({ provider: 'enterprise', model: ${JSON.stringify(model)}, system: 'Reply with a tool call.', messages: [] })) chunks.push(chunk);
  console.log('ENTERPRISE_NATIVE_PROFILE ' + JSON.stringify(chunks));
}
`,
  })
}
