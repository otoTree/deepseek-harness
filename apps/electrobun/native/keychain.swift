import Foundation
import Security

// This helper is a credential bridge, not a DSH application launcher.
let args = CommandLine.arguments
guard args.count == 3, ["get", "set", "delete"].contains(args[1]), !args[2].isEmpty else { exit(2) }
#if ARIVO_STUDIO
let service = "com.arivo.studio"
let credentialLabel = "Arivo"
let legacyService: String? = nil
#else
let service = "com.zhiyu.os.enterprise"
let credentialLabel = "智域OS"
let legacyService: String? = "ai.deepseek.harness.enterprise"
#endif
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: args[2],
]
var status: OSStatus
switch args[1] {
case "set":
    var data = Data()
    while data.count <= 65536 {
        let chunk = FileHandle.standardInput.readData(ofLength: min(8192, 65537 - data.count))
        if chunk.isEmpty { break }
        data.append(chunk)
    }
    guard !data.isEmpty, data.count <= 65536 else { exit(2) }
    status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data, kSecAttrLabel as String: credentialLabel] as CFDictionary)
    if status == errSecItemNotFound, let legacyService {
        var legacy = query
        legacy[kSecAttrService as String] = legacyService
        let moved = SecItemUpdate(legacy as CFDictionary, [kSecAttrService as String: service,
            kSecAttrLabel as String: credentialLabel] as CFDictionary)
        guard moved == errSecSuccess || moved == errSecItemNotFound else { exit(1) }
        if moved == errSecSuccess {
            status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        }
    }
    if status == errSecItemNotFound {
        var item = query
        item[kSecAttrLabel as String] = credentialLabel
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        status = SecItemAdd(item as CFDictionary, nil)
    }
case "get":
    var read = query
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    status = SecItemCopyMatching(read as CFDictionary, &result)
    if status == errSecItemNotFound, let legacyService {
        var legacy = query
        legacy[kSecAttrService as String] = legacyService
        // Updating the existing item preserves its credential and access-control record.
        let moved = SecItemUpdate(legacy as CFDictionary, [kSecAttrService as String: service,
            kSecAttrLabel as String: credentialLabel] as CFDictionary)
        guard moved == errSecSuccess || moved == errSecItemNotFound else { exit(1) }
        status = SecItemCopyMatching(read as CFDictionary, &result)
    }
    if status == errSecSuccess {
        guard let data = result as? Data else { exit(1) }
        FileHandle.standardOutput.write(data)
    }
default:
    status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { exit(1) }
    if let legacyService {
        var legacy = query
        legacy[kSecAttrService as String] = legacyService
        let removed = SecItemDelete(legacy as CFDictionary)
        guard removed == errSecSuccess || removed == errSecItemNotFound else { exit(1) }
        if removed == errSecSuccess { status = errSecSuccess }
    }
}
if status == errSecItemNotFound { exit(44) }
if status != errSecSuccess {
    FileHandle.standardError.write(Data("Keychain OSStatus: \(status)\n".utf8))
    exit(1)
}
