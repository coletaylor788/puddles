import Darwin
import Foundation
import LocalAuthentication
import Security

private let identifier = "com.coletaylor788.puddles.keychain-helper"
private let allowlistHeader = "puddles-keychain-helper-v1"
private let maximumAllowlistBytes: off_t = 65_536
private let maximumEntries = 32
private let maximumSelectorLength = 256

#if REBUILD_VARIANT_TWO
private let buildVariant: UInt8 = 2
#else
private let buildVariant: UInt8 = 1
#endif

private struct SecretSelector {
    let service: String
    let account: String
}

private enum HelperError: Error {
    case usage
    case config(String)
    case unknownAlias
    case keychain(String)
    case output

    var exitCode: Int32 {
        switch self {
        case .usage:
            return 64
        case .config:
            return 78
        case .unknownAlias:
            return 65
        case .keychain:
            return 69
        case .output:
            return 74
        }
    }

    var message: String {
        switch self {
        case .usage:
            return "usage: puddles-keychain-helper [--approve] <alias>"
        case let .config(reason):
            return "allowlist error: \(reason)"
        case .unknownAlias:
            return "requested alias is not allowlisted"
        case let .keychain(reason):
            return "Keychain read failed: \(reason)"
        case .output:
            return "could not write secret to stdout"
        }
    }
}

private func fail(_ error: HelperError) -> Never {
    FileHandle.standardError.write(Data("\(error.message)\n".utf8))
    exit(error.exitCode)
}

private func defaultAllowlistPath() -> String {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/puddles-keychain-helper/allowlist.tsv")
        .path
}

private func allowlistPath() -> String {
    #if TESTING
    if let override = ProcessInfo.processInfo.environment[
        "PUDDLES_KEYCHAIN_HELPER_TEST_ALLOWLIST"
    ], !override.isEmpty {
        return override
    }
    #endif
    return defaultAllowlistPath()
}

private func readAllowlistFile(_ path: String) throws -> Data {
    let descriptor = open(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else {
        throw HelperError.config("file is missing or not a regular file")
    }
    defer { close(descriptor) }

    var fileInfo = stat()
    guard fstat(descriptor, &fileInfo) == 0 else {
        throw HelperError.config("file metadata could not be read")
    }
    guard (fileInfo.st_mode & S_IFMT) == S_IFREG else {
        throw HelperError.config("file must be a regular non-symlink")
    }
    guard fileInfo.st_uid == getuid() else {
        throw HelperError.config("file must be owned by the current user")
    }
    guard (fileInfo.st_mode & 0o077) == 0 else {
        throw HelperError.config("file permissions must not grant group or other access")
    }
    errno = 0
    if let accessControlList = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED) {
        defer { acl_free(UnsafeMutableRawPointer(accessControlList)) }
        throw HelperError.config("file must not have extended ACL entries")
    } else if errno != ENOENT {
        throw HelperError.config("file ACL could not be inspected")
    }
    guard fileInfo.st_size <= maximumAllowlistBytes else {
        throw HelperError.config("file is too large")
    }

    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
        let count = read(descriptor, &buffer, buffer.count)
        guard count >= 0 else {
            throw HelperError.config("file could not be read")
        }
        if count == 0 {
            break
        }
        data.append(buffer, count: count)
        guard data.count <= maximumAllowlistBytes else {
            throw HelperError.config("file is too large")
        }
    }
    return data
}

private func isValidAlias(_ value: String) -> Bool {
    value.range(
        of: #"^[a-z][a-z0-9-]{0,63}$"#,
        options: .regularExpression
    ) != nil
}

private func isValidSelector(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= maximumSelectorLength else {
        return false
    }
    return value.unicodeScalars.allSatisfy {
        !CharacterSet.controlCharacters.contains($0)
    }
}

private func loadAllowlist() throws -> [String: SecretSelector] {
    let path = allowlistPath()
    let data = try readAllowlistFile(path)
    guard let text = String(data: data, encoding: .utf8) else {
        throw HelperError.config("file must be UTF-8")
    }

    var lines = text.split(
        separator: "\n",
        omittingEmptySubsequences: false
    ).map(String.init)
    if lines.last == "" {
        lines.removeLast()
    }
    guard lines.first == allowlistHeader else {
        throw HelperError.config("unsupported or missing version header")
    }

    var result: [String: SecretSelector] = [:]
    for line in lines.dropFirst() {
        guard !line.isEmpty else {
            throw HelperError.config("blank entries are not allowed")
        }
        let fields = line.split(
            separator: "\t",
            omittingEmptySubsequences: false
        ).map(String.init)
        guard fields.count == 3 else {
            throw HelperError.config("each entry must contain alias, service, and account")
        }
        let alias = fields[0]
        guard isValidAlias(alias) else {
            throw HelperError.config("an alias is invalid")
        }
        guard isValidSelector(fields[1]), isValidSelector(fields[2]) else {
            throw HelperError.config("a service or account selector is invalid")
        }
        guard result[alias] == nil else {
            throw HelperError.config("duplicate aliases are not allowed")
        }
        result[alias] = SecretSelector(service: fields[1], account: fields[2])
        guard result.count <= maximumEntries else {
            throw HelperError.config("too many entries")
        }
    }
    guard !result.isEmpty else {
        throw HelperError.config("at least one entry is required")
    }
    return result
}

private func readSecret(
    _ selector: SecretSelector,
    allowInteraction: Bool
) throws -> Data {
    #if TESTING
    if let expected = ProcessInfo.processInfo.environment[
        "PUDDLES_KEYCHAIN_HELPER_TEST_EXPECT_INTERACTION"
    ] {
        let actual = allowInteraction ? "allow" : "deny"
        guard expected == actual else {
            throw HelperError.keychain("unexpected interaction mode")
        }
    }
    switch ProcessInfo.processInfo.environment[
        "PUDDLES_KEYCHAIN_HELPER_TEST_RESULT"
    ] {
    case "success":
        return Data("synthetic-secret-value".utf8)
    case "binary":
        return Data([0x6c, 0x65, 0x66, 0x74, 0x00, 0x72, 0x69, 0x67, 0x68, 0x74])
    case "empty":
        throw HelperError.keychain("item contains no data")
    case "missing":
        throw HelperError.keychain("item was not found")
    case "denied":
        throw HelperError.keychain("access was denied")
    case "interaction":
        throw HelperError.keychain("interaction is required but unavailable")
    default:
        throw HelperError.keychain("test result is not configured")
    }
    #else
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: selector.service,
        kSecAttrAccount: selector.account,
        kSecReturnData: true,
        kSecMatchLimit: kSecMatchLimitOne,
    ]
    var effectiveQuery = query
    if !allowInteraction {
        let context = LAContext()
        context.interactionNotAllowed = true
        effectiveQuery[kSecUseAuthenticationContext] = context
    }

    var item: CFTypeRef?
    let status = SecItemCopyMatching(effectiveQuery as CFDictionary, &item)
    switch status {
    case errSecSuccess:
        guard let data = item as? Data, !data.isEmpty else {
            throw HelperError.keychain("item contains no data")
        }
        return data
    case errSecItemNotFound:
        throw HelperError.keychain("item was not found")
    case errSecAuthFailed:
        throw HelperError.keychain("access was denied")
    case errSecInteractionNotAllowed:
        throw HelperError.keychain("interaction is required but unavailable")
    default:
        throw HelperError.keychain("status \(status)")
    }
    #endif
}

private func requireEnvironmentSafeSecret(_ data: Data) throws {
    guard !data.contains(0), String(data: data, encoding: .utf8) != nil else {
        throw HelperError.keychain("item is not valid text for an environment variable")
    }
}

private func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let alias: String
    let allowInteraction: Bool
    if arguments.count == 1 {
        alias = arguments[0]
        allowInteraction = false
    } else if arguments.count == 2, arguments[0] == "--approve" {
        alias = arguments[1]
        allowInteraction = true
    } else {
        throw HelperError.usage
    }
    guard isValidAlias(alias) else {
        throw HelperError.unknownAlias
    }
    let allowlist = try loadAllowlist()
    guard let selector = allowlist[alias] else {
        throw HelperError.unknownAlias
    }
    let secret = try readSecret(
        selector,
        allowInteraction: allowInteraction
    )
    if ProcessInfo.processInfo.environment[
        "PUDDLES_KEYCHAIN_HELPER_REQUIRE_TEXT"
    ] == "1" {
        try requireEnvironmentSafeSecret(secret)
    }
    do {
        try FileHandle.standardOutput.write(contentsOf: secret)
    } catch {
        throw HelperError.output
    }
}

withExtendedLifetime((identifier, buildVariant)) {
    do {
        try run()
    } catch let error as HelperError {
        fail(error)
    } catch {
        fail(.keychain("unexpected failure"))
    }
}
