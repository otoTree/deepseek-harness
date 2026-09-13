import { defineElectrobunRPC, type ElectrobunRPCSchema } from 'electrobun/main/rpc'
import { openExternal, showNotification } from 'electrobun/main/utils'
import { pickNativeDirectory } from '@deepseek-ai/dsh-host-directory-picker-native'
import { nativeNotification, validateNativeExternalUrl } from './native-bridge-policy.ts'

/** Browser-to-host requests exposed by the trusted enterprise Web UI. */
export interface EnterpriseNativeSchema extends ElectrobunRPCSchema {
  bun: {
    requests: Record<never, never>
    messages: Record<never, never>
  }
  webview: {
    requests: {
      chooseDirectory: { params: undefined; response: string | null }
      notify: { params: { title: string; body: string }; response: undefined }
      openExternal: { params: { url: string }; response: boolean }
      switchOrganization: { params: undefined; response: undefined }
      logout: { params: undefined; response: undefined }
      quit: { params: undefined; response: undefined }
    }
    messages: Record<never, never>
  }
}

/** Lifecycle actions owned by the desktop session rather than the WebView. */
export interface EnterpriseNativeActions {
  switchOrganization: () => void | Promise<void>
  logout: () => void | Promise<void>
  quit: () => void | Promise<void>
}

/** Create the allow-listed native bridge for the enterprise window. */
export function createNativeBridge(actions: EnterpriseNativeActions) {
  return defineElectrobunRPC<EnterpriseNativeSchema, 'bun'>('bun', {
    handlers: {
      requests: {},
    },
    extraRequestHandlers: {
      chooseDirectory: async () => pickNativeDirectory(new AbortController().signal),
      notify: (value: unknown) => {
        const input = nativeNotification.parse(value)
        showNotification(input)
      },
      openExternal: (value: unknown) => {
        return openExternal(validateNativeExternalUrl(value))
      },
      switchOrganization: async () => { await actions.switchOrganization() },
      logout: async () => { await actions.logout() },
      quit: async () => { await actions.quit() },
    },
  })
}
