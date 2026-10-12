import Foundation
import CryptoKit

private func encodeNativeTimestamp(_ date: Date, encoder: Encoder) throws {
    let milliseconds = (date.timeIntervalSince1970 * 1_000).rounded(.down)
    guard milliseconds.isFinite, abs(milliseconds) <= 8_640_000_000_000_000 else {
        throw EncodingError.invalidValue(date, .init(codingPath: encoder.codingPath, debugDescription: "Invalid native timestamp"))
    }
    var container = encoder.singleValueContainer()
    try container.encode(Int64(milliseconds))
}

struct NativeList: Codable, Equatable {
    let id: String
    let title: String
    let writable: Bool
}

struct NativeDate: Codable, Equatable {
    let year: Int?
    let month: Int?
    let day: Int?
    let hour: Int?
    let minute: Int?
    let second: Int?
    let timeZone: String?
    let calendarID: String?
    let era: Int?
    let isLeapMonth: Bool?
    let floating: Bool

    init(_ value: DateComponents, reminderTimeZone: TimeZone? = nil) {
        year = value.year; month = value.month; day = value.day
        hour = value.hour; minute = value.minute; second = value.second
        floating = value.hour != nil && value.timeZone == nil && reminderTimeZone == nil
        timeZone = value.hour != nil ? (value.timeZone ?? reminderTimeZone ?? TimeZone.current).identifier : value.timeZone?.identifier
        calendarID = value.calendar.map { String(describing: $0.identifier) }
        era = value.era; isLeapMonth = value.isLeapMonth
    }
}

struct NativeReminder: Codable, Equatable {
    let id: String
    let externalID: String?
    let listID: String
    let title: String
    let notes: String?
    let url: String?
    var completed: Bool
    var completionDate: Date?
    let due: NativeDate?
    let start: NativeDate?
    let priority: Int
    let modifiedAt: Date?
    let recurring: Bool

    var revision: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .custom(encodeNativeTimestamp)
        guard let bytes = try? encoder.encode(self) else { return "" }
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}

struct NativeSnapshot: Encodable {
    let schemaVersion = 1
    let generatedAt: Date
    let sample: Bool
    let selectedListIDs: [String]
    let lists: [NativeList]
    let reminders: [NativeReminder]
    let revisions: [String: String]
    init(generatedAt: Date, sample: Bool, selectedListIDs: [String], lists: [NativeList], reminders: [NativeReminder]) {
        self.generatedAt = generatedAt; self.sample = sample; self.selectedListIDs = selectedListIDs
        self.lists = lists; self.reminders = reminders
        self.revisions = Dictionary(uniqueKeysWithValues: reminders.map { ($0.id, $0.revision) })
    }
    let unsupportedFeatures = ["tags", "subtasks", "flags", "photos", "shoppingCategories", "sections", "assignment", "smartListDefinitions", "recurrenceRules", "alarms"]

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .custom(encodeNativeTimestamp)
        return try encoder.encode(self)
    }
}

// A future authenticated device API supplies this command; no JS bridge may call it.
struct NativeCompletionCommand: Codable {
    let id: String
    let taskID: String
    let reminderID: String
    let listID: String
    let expectedRevision: String
    let expiresAt: Date
}

enum NativeSyncError: Error, LocalizedError, Equatable {
    case permission, noLists, missingReminder, conflict, writebackDisabled, invalidCommand, insecureOrigin, unsupported, importTooLarge, invalidSnapshot, browserChanged
    var errorDescription: String? {
        switch self {
        case .permission: return "Reminders access is not enabled."
        case .noLists: return "Select at least one reminder list."
        case .missingReminder: return "The original reminder is unavailable. Refresh your preview."
        case .conflict: return "The reminder changed in Apple Reminders. Refresh before completing it."
        case .writebackDisabled: return "Task completion writeback is off on this device."
        case .invalidCommand: return "The completion command is invalid or expired."
        case .insecureOrigin: return "Use HTTPS, or localhost for isolated development."
        case .unsupported: return "This action is not available in the companion foundation."
        case .importTooLarge: return "This selection is too large to import locally. Choose fewer lists or shorten the oversized reminder."
        case .invalidSnapshot: return "The selected preview is invalid. Preview your selected lists again."
        case .browserChanged: return "The web page changed. Return to Accounts and start a fresh import."
        }
    }
}

enum LocalImportPolicy {
    static let maximumLists = 100
    static let maximumReminders = 5_000
    static let maximumBytes = 2 * 1_024 * 1_024

    static func validateDestination(page: URL?, origin: URL, requestedGeneration: Int, currentGeneration: Int) throws {
        guard requestedGeneration == currentGeneration, CompanionOrigin.matches(page, origin) else {
            throw NativeSyncError.browserChanged
        }
    }

    static func encoded(_ snapshot: NativeSnapshot) throws -> Data {
        guard !snapshot.lists.isEmpty, snapshot.lists.count <= maximumLists,
              snapshot.reminders.count <= maximumReminders else { throw NativeSyncError.importTooLarge }
        let selected = Set(snapshot.selectedListIDs), listIDs = Set(snapshot.lists.map(\.id))
        guard selected.count == snapshot.selectedListIDs.count, selected == listIDs,
              listIDs.count == snapshot.lists.count,
              Set(snapshot.reminders.map(\.id)).count == snapshot.reminders.count,
              snapshot.reminders.allSatisfy({ selected.contains($0.listID) && (0...9).contains($0.priority) }) else {
            throw NativeSyncError.invalidSnapshot
        }
        func validDate(_ value: Date?) -> Bool {
            guard let value else { return true }
            return value.timeIntervalSince1970.isFinite && abs(value.timeIntervalSince1970) <= 8_640_000_000_000
        }
        guard validDate(snapshot.generatedAt), snapshot.reminders.allSatisfy({
            validDate($0.completionDate) && validDate($0.modifiedAt)
        }) else { throw NativeSyncError.invalidSnapshot }
        func bounded(_ value: String?, _ limit: Int, required: Bool = false) -> Bool {
            guard let value else { return !required }
            return (!required || !value.isEmpty) && value.utf8.count <= limit
        }
        func boundedDate(_ value: NativeDate?) -> Bool {
            guard let value else { return true }
            return bounded(value.timeZone, 256) && bounded(value.calendarID, 64)
        }
        guard snapshot.lists.allSatisfy({ bounded($0.id, 1_024, required: true) && bounded($0.title, 512) }),
              snapshot.reminders.allSatisfy({
                  bounded($0.id, 1_024, required: true) && bounded($0.externalID, 1_024)
                  && bounded($0.listID, 1_024, required: true) && bounded($0.title, 1_024)
                  && bounded($0.notes, 16_384) && bounded($0.url, 4_096)
                  && boundedDate($0.due) && boundedDate($0.start)
              }) else { throw NativeSyncError.importTooLarge }
        let data = try snapshot.encoded()
        guard data.count <= maximumBytes else { throw NativeSyncError.importTooLarge }
        return data
    }
}

enum CompletionPolicy {
    static func validate(_ command: NativeCompletionCommand, reminder: NativeReminder,
                         selectedListIDs: Set<String>, enabled: Bool, now: Date) throws {
        guard enabled else { throw NativeSyncError.writebackDisabled }
        guard !command.id.isEmpty, !command.taskID.isEmpty, !command.expectedRevision.isEmpty,
              command.expiresAt > now else { throw NativeSyncError.invalidCommand }
        guard selectedListIDs.contains(command.listID), command.listID == reminder.listID,
              command.reminderID == reminder.id else { throw NativeSyncError.missingReminder }
        // shortcut: recurring writeback stays blocked until native occurrence/child effects are verified.
        guard !reminder.recurring else { throw NativeSyncError.unsupported }
        guard command.expectedRevision == reminder.revision else { throw NativeSyncError.conflict }
    }
}

enum CompanionOrigin {
    static func validate(_ text: String) throws -> URL {
        guard let url = URL(string: text), let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { throw NativeSyncError.insecureOrigin }
        let local = host == "localhost" || host == "127.0.0.1" || host == "::1"
        guard url.scheme == "https" || (url.scheme == "http" && local) else {
            throw NativeSyncError.insecureOrigin
        }
        return url
    }

    static func matches(_ first: URL?, _ second: URL) -> Bool {
        guard let first else { return false }
        func port(_ value: URL) -> Int { value.port ?? (value.scheme == "https" ? 443 : 80) }
        return first.scheme == second.scheme && first.host?.lowercased() == second.host?.lowercased()
            && port(first) == port(second)
    }
}

// Pure gate; the cookie transport itself is compiled only for Simulator.
enum UITestSessionPolicy {
    static func allows(environment: [String: String], origin: URL) -> Bool {
        environment["REA_UI_TEST"] == "1" && origin.scheme == "http" && origin.host == "localhost"
            && origin.port == 8081 && origin.user == nil && origin.password == nil
            && origin.query == nil && origin.fragment == nil && (origin.path.isEmpty || origin.path == "/")
    }
}
