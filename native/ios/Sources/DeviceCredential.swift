import Foundation
import Security

enum DeviceCredential {
    private static let service = "local.rea.agentreminders.device"
    private static let account = "device-bearer"
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }
    static func save(_ token: String) throws {
        guard !token.isEmpty, token.utf8.count <= 4096, !token.contains(where: { $0.isWhitespace }) else {
            throw NativeSyncError.invalidCommand
        }
        let data = Data(token.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw NativeSyncError.unsupported }
        } else if status != errSecSuccess { throw NativeSyncError.unsupported }
    }
    static func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeSyncError.unsupported }
    }
    static func read() throws -> String? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(search as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else { throw NativeSyncError.unsupported }
        return token
    }
    // Credentials never enter the WKWebView or a snapshot. Pairing and sync use native-only URLSession transport.
    static func isStored() -> Bool {
        var search = query
        search[kSecReturnAttributes as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        return SecItemCopyMatching(search as CFDictionary, nil) == errSecSuccess
    }
}
