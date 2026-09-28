import Foundation
import Security
import SottoCore

struct KeychainStore {
    private let service = "Sotto.host-client"
    func read<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        var query = base(account); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Self.failure }
        return try JSONDecoder().decode(type, from: data)
    }
    func write<T: Encodable>(_ value: T, account: String) throws {
        let data = try JSONEncoder().encode(value)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(base(account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var query = base(account); attributes.forEach { query[$0] = $1 }
            guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw Self.failure }
        } else if status != errSecSuccess { throw Self.failure }
    }
    func remove(account: String) throws {
        let status = SecItemDelete(base(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.failure }
    }
    private func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }
    /// Secure storage could not be opened, as against an item that is missing or unreadable.
    static let failure = ClientError.rejected("Sotto could not access secure storage. Unlock this iPhone and try again.")
}
