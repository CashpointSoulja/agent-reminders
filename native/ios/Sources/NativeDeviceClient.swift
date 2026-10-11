import Foundation
import Security
import CryptoKit

@MainActor
protocol NativeSecrets {
    func read() throws -> String?
    func save(_ token: String) throws
    func clear() throws
}
@MainActor
final class SampleSecrets: NativeSecrets {
    static let shared = SampleSecrets()
    private var value: String?
    func read() throws -> String? { value }
    func save(_ token: String) throws { value = token }
    func clear() throws { value = nil }
}
@MainActor
final class KeychainSecrets: NativeSecrets {
    func read() throws -> String? { try DeviceCredential.read() }
    func save(_ token: String) throws { try DeviceCredential.save(token) }
    func clear() throws { try DeviceCredential.delete() }
}
struct NativeDeviceGrant: Decodable {
    let id: String
    let name: String
    let lists: [NativeList]
    let activeListIDs: [String]
    let writebackListIDs: [String]
    let grantVersion: Int
    let expiresAt: Double
}
struct NativePairing: Decodable {
    let pairingId: String
    let code: String
    let expiresAt: Double
    let pollIntervalSeconds: Int
}
private struct CommandEnvelope: Decodable {
    let command: NativeQueuedCommand?
    let commands: [NativeQueuedCommand]?
}
private struct DeviceEnvelope: Decodable {
    let device: NativeDeviceGrant?
    let revision: Int?
    let state: String?
}
struct NativeQueuedCommand: Decodable {
    let id: String
    let taskID: String
    let reminderID: String
    let listID: String
    let expectedRevision: String
    let expiresAt: Double
    let grantVersion: Int
    let claimID: String?
    let claimExpiresAt: Double?
    var core: NativeCompletionCommand {
        NativeCompletionCommand(id: id, taskID: taskID, reminderID: reminderID, listID: listID,
            expectedRevision: expectedRevision, expiresAt: Date(timeIntervalSince1970: min(expiresAt, claimExpiresAt ?? expiresAt) / 1000))
    }
}
struct NativeJournalEntry: Codable {
    let commandID: String
    let origin: String
    let deviceID: String
    var claimID: String
    let sourceID: String
    let sourceListID: String
    let beforeRevision: String
    var outcome: String?
    var observedRevision: String?
    var completed: Bool
}
@MainActor
protocol NativeCommandJournal {
    func get(_ id: String) throws -> NativeJournalEntry?
    func all() throws -> [NativeJournalEntry]
    func put(_ entry: NativeJournalEntry) throws
    func remove(_ id: String) throws
}
@MainActor
final class SampleCommandJournal: NativeCommandJournal {
    static let shared = SampleCommandJournal()
    private var entries: [String: NativeJournalEntry] = [:]
    func get(_ id: String) throws -> NativeJournalEntry? { entries[id] }
    func all() throws -> [NativeJournalEntry] { Array(entries.values) }
    func put(_ entry: NativeJournalEntry) throws { entries[entry.commandID] = entry }
    func remove(_ id: String) throws { entries.removeValue(forKey: id) }
}
@MainActor
final class ProtectedCommandJournal: NativeCommandJournal {
    private let url: URL
    init() throws {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        url = directory.appendingPathComponent("native-command-journal.json")
    }
    private func load() throws -> [String: NativeJournalEntry] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        return try JSONDecoder().decode([String: NativeJournalEntry].self, from: Data(contentsOf: url))
    }
    private func save(_ entries: [String: NativeJournalEntry]) throws {
        guard entries.count <= 256 else { throw NativeSyncError.unsupported }
        let data = try JSONEncoder().encode(entries)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
    func get(_ id: String) throws -> NativeJournalEntry? { try load()[id] }
    func all() throws -> [NativeJournalEntry] { Array(try load().values) }
    func put(_ entry: NativeJournalEntry) throws { var entries = try load(); entries[entry.commandID] = entry; try save(entries) }
    func remove(_ id: String) throws { var entries = try load(); entries.removeValue(forKey: id); try save(entries) }
}
private final class NoDeviceRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
struct NativeConflictSummary: Decodable {
    let title: String
    let notes: String
    let completed: Bool
    let url: String
    let dueDate: String?
    let dueTime: String?
    let timeZone: String
    let priority: String
}
struct NativeImportConflict: Decodable {
    let kind: String
    let sourceID: String
    let reason: String
    let sourceRevision: String?
    let webFingerprint: String?
    let apple: NativeConflictSummary?
    let cloud: NativeConflictSummary?
}
struct NativeConflictResolution: Encodable {
    let sourceID: String
    let sourceRevision: String
    let webFingerprint: String
    let choice: String
}
struct NativeDeviceError: Error, LocalizedError {
    let status: Int
    let message: String
    let conflicts: [NativeImportConflict]
    init(status: Int, message: String, conflicts: [NativeImportConflict] = []) { self.status = status; self.message = message; self.conflicts = conflicts }
    var errorDescription: String? { message }
}

@MainActor
final class NativeDeviceClient {
    typealias Transport = (URLRequest) async throws -> (Data, HTTPURLResponse)
    let origin: URL
    private let secrets: NativeSecrets
    private let journal: NativeCommandJournal
    private let transport: Transport
    private(set) var grant: NativeDeviceGrant?
    private(set) var revision: Int?
    private var processing = false
    init(origin: URL, secrets: NativeSecrets, journal: NativeCommandJournal, transport: Transport? = nil) {
        self.origin = origin; self.secrets = secrets; self.journal = journal
        if let transport { self.transport = transport }
        else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpCookieStorage = nil; configuration.urlCache = nil; configuration.httpShouldSetCookies = false
            let session = URLSession(configuration: configuration, delegate: NoDeviceRedirect(), delegateQueue: nil)
            self.transport = { request in
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse else { throw NativeSyncError.unsupported }
                return (data, response)
            }
        }
    }
    static func make(origin: URL) throws -> NativeDeviceClient {
        #if targetEnvironment(simulator)
        return NativeDeviceClient(origin: origin, secrets: SampleSecrets.shared, journal: SampleCommandJournal.shared)
        #else
        return NativeDeviceClient(origin: origin, secrets: KeychainSecrets(), journal: try ProtectedCommandJournal())
        #endif
    }
    private func send(_ path: String, method: String = "GET", data: Data? = nil, key: String? = nil,
                      anonymous: Bool = false, useRevision: Bool = false) async throws -> Data {
        var request = URLRequest(url: origin.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = method; request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if data != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if !anonymous {
            guard let token = try secrets.read() else { throw NativeSyncError.permission }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if useRevision {
            guard let revision else { throw NativeSyncError.conflict }
            request.setValue(String(revision), forHTTPHeaderField: "If-Match")
        }
        if let key { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        let (bytes, response) = try await transport(request)
        guard CompanionOrigin.matches(response.url, origin) else { throw NativeSyncError.insecureOrigin }
        guard (200...299).contains(response.statusCode) else {
            let error = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any]
            let conflicts = error?["conflicts"].flatMap { try? JSONSerialization.data(withJSONObject: $0) }.flatMap { try? JSONDecoder().decode([NativeImportConflict].self, from: $0) } ?? []
            throw NativeDeviceError(status: response.statusCode, message: error?["error"] as? String ?? "Device request failed.", conflicts: conflicts)
        }
        if let object = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any], let next = object["revision"] as? Int { revision = next }
        return bytes
    }
    private func body(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) }
    func pair(lists: [NativeList], name: String) async throws -> NativePairing {
        guard !lists.isEmpty else { throw NativeSyncError.noLists }
        if (try? secrets.read()) != nil, (try? await activate()) == true { throw NativeDeviceError(status: 409, message: "This device is already paired. Disconnect before pairing another source.") }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NativeSyncError.unsupported }
        let token = "rwd_" + Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        try secrets.save(token)
        let tokenHash = SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
        let payload = try body(["name": name, "tokenHash": tokenHash, "lists": lists.map { ["id": $0.id, "title": $0.title, "writable": $0.writable] as [String: Any] }])
        do { return try JSONDecoder().decode(NativePairing.self, from: await send("api/device/v1/pairings", method: "POST", data: payload, anonymous: true)) }
        catch { try? secrets.clear(); throw error }
    }
    @discardableResult
    func activate() async throws -> Bool {
        let result = try JSONDecoder().decode(DeviceEnvelope.self, from: await send("api/device/v1/me"))
        grant = result.device; revision = result.revision
        return result.device != nil
    }
    func configure(selected: Set<String>, writeback: Bool) async throws {
        guard try await activate() else { throw NativeSyncError.permission }
        let writable = Set(grant?.lists.filter(\.writable).map(\.id) ?? [])
        let writebackLists = writeback ? selected.intersection(writable) : []
        if Set(grant?.activeListIDs ?? []) == selected && Set(grant?.writebackListIDs ?? []) == writebackLists { return }
        let payload = try body(["activeListIDs": selected.sorted(), "writebackListIDs": writebackLists.sorted()])
        let result = try JSONDecoder().decode(DeviceEnvelope.self, from: await send("api/device/v1/config", method: "PATCH", data: payload, useRevision: true))
        grant = result.device
    }
    func upload(_ snapshot: NativeSnapshot, key: String, resolutions: [NativeConflictResolution] = []) async throws {
        guard try await activate(), let grant, Set(snapshot.selectedListIDs).isSubset(of: Set(grant.activeListIDs)) else { throw NativeSyncError.permission }
        var payload = try JSONSerialization.jsonObject(with: snapshot.encoded()) as! [String: Any]
        if !resolutions.isEmpty { payload["resolutions"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(resolutions)) }
        _ = try await send("api/device/v1/imports", method: "POST", data: try body(payload), key: key, useRevision: true)
    }
    func clearLocalCredential() throws { try secrets.clear(); grant = nil; revision = nil }
    func disconnect() async throws {
        defer { try? secrets.clear(); grant = nil; revision = nil }
        if try await activate() { _ = try await send("api/device/v1/revoke", method: "POST", data: try body([:]), useRevision: true) }
    }
    private func acknowledge(_ receipt: NativeJournalEntry) async throws {
        guard let outcome = receipt.outcome else { throw NativeSyncError.invalidCommand }
        _ = try await send("api/device/v1/commands/\(receipt.commandID)/ack", method: "POST", data: try body([
            "claimID": receipt.claimID, "outcome": outcome, "observedRevision": receipt.observedRevision as Any? ?? NSNull(), "completed": receipt.completed
        ]), useRevision: true)
    }
    func finishCommands(store: ReminderStore, selected: Set<String>, locallyEnabled: Bool) async throws -> Int {
        guard !processing else { return 0 }; processing = true; defer { processing = false }
        guard try await activate(), let grant else { return 0 }
        var finished = 0
        // A committed acknowledgement may vanish from the queue before its response reaches this phone.
        for entry in try journal.all().filter({ $0.origin == origin.absoluteString && $0.deviceID == grant.id && $0.outcome != nil }) {
            try await acknowledge(entry)
            try journal.remove(entry.commandID); finished += 1
        }
        guard locallyEnabled else { return finished }
        guard selected.isSubset(of: Set(grant.activeListIDs)), !selected.intersection(Set(grant.writebackListIDs)).isEmpty else { throw NativeSyncError.writebackDisabled }
        let envelope = try JSONDecoder().decode(CommandEnvelope.self, from: await send("api/device/v1/commands"))
        guard let commands = envelope.commands else { throw NativeSyncError.invalidCommand }
        for command in commands {
            guard selected.contains(command.listID) else { continue }
            guard grant.writebackListIDs.contains(command.listID), command.grantVersion == grant.grantVersion else { throw NativeSyncError.invalidCommand }
            var entry = try journal.get(command.id)
            if entry == nil {
                entry = NativeJournalEntry(commandID: command.id, origin: origin.absoluteString, deviceID: grant.id, claimID: UUID().uuidString, sourceID: command.reminderID,
                    sourceListID: command.listID, beforeRevision: command.expectedRevision, outcome: nil, observedRevision: nil, completed: false)
                try journal.put(entry!)
            }
            var receipt = entry!
            guard receipt.origin == origin.absoluteString, receipt.deviceID == grant.id,
                  receipt.sourceID == command.reminderID, receipt.sourceListID == command.listID,
                  receipt.beforeRevision == command.expectedRevision else { throw NativeSyncError.invalidCommand }
            if receipt.outcome == nil {
                let claimed = try await send("api/device/v1/commands/\(command.id)/claim", method: "POST", data: try body(["claimID": receipt.claimID]), useRevision: true)
                guard let leased = try JSONDecoder().decode(CommandEnvelope.self, from: claimed).command else { throw NativeSyncError.invalidCommand }
                let before = try await store.snapshot(selectedListIDs: [command.listID]).reminders.first { $0.id == command.reminderID }
                if let before, before.completed {
                    receipt.outcome = "applied"; receipt.observedRevision = before.revision; receipt.completed = true
                } else {
                    var saved = false
                    do {
                        try await store.complete(leased.core, selectedListIDs: selected, enabled: locallyEnabled)
                        saved = true
                    } catch {
                        guard error is NativeSyncError else { throw error }
                        receipt.outcome = (error as? NativeSyncError) == .missingReminder ? "missing" : (error as? NativeSyncError) == .unsupported ? "unsupported" : "conflict"
                        receipt.observedRevision = before?.revision; receipt.completed = before?.completed ?? false
                    }
                    if saved {
                        // Failed readback after a save is an unknown outcome, never a permanent conflict.
                        let after = try await store.snapshot(selectedListIDs: [command.listID]).reminders.first { $0.id == command.reminderID }
                        guard let after, after.completed else { throw NativeSyncError.conflict }
                        receipt.outcome = "applied"; receipt.observedRevision = after.revision; receipt.completed = true
                    }
                }
                try journal.put(receipt)
            }
            try await acknowledge(receipt)
            try journal.remove(command.id); finished += 1
        }
        return finished
    }
}
