import Foundation

@main
struct SyncCoreTests {
    @MainActor
    static func main() async throws {
        var passed = 0
        func check(_ condition: @autoclosure () -> Bool, _ name: String) {
            precondition(condition(), name); passed += 1
        }
        func rejected(_ operation: () throws -> Void, _ name: String) {
            do { try operation(); preconditionFailure(name) } catch { passed += 1 }
        }
        let store = SampleReminderStore()
        try await store.requestAccess()
        let lists = try store.lists()
        check(lists.count == 1 && lists[0].id == "sample-list", "Synthetic list selection")
        do { _ = try await store.snapshot(selectedListIDs: []); preconditionFailure("Empty selection read") } catch { passed += 1 }
        do { _ = try await store.snapshot(selectedListIDs: ["other-list"]); preconditionFailure("Unselected list read") } catch { passed += 1 }
        let snapshot = try await store.snapshot(selectedListIDs: ["sample-list"])
        let record = snapshot.reminders[0]
        check(snapshot.sample && snapshot.reminders.count == 1 && snapshot.selectedListIDs == ["sample-list"], "Scoped snapshot")
        let dateOnly = NativeDate(DateComponents(calendar: Calendar(identifier: .gregorian), year: 2026, month: 10, day: 11))
        check(dateOnly.hour == nil && dateOnly.calendarID == "gregorian", "Date-only calendar components preserved")
        let timed = NativeDate(DateComponents(timeZone: TimeZone(identifier: "Europe/London"), year: 2026, month: 10, day: 11, hour: 0, minute: 0))
        check(timed.hour == 0 && timed.timeZone == "Europe/London", "Midnight and time zone preserved")
        let floating = NativeDate(DateComponents(year: 2026, month: 10, day: 11, hour: 7, minute: 30))
        check(floating.floating && floating.timeZone == TimeZone.current.identifier, "Floating time is explicitly resolved on its device")
        let object = try JSONSerialization.jsonObject(with: snapshot.encoded()) as! [String: Any]
        check((object["revisions"] as? [String: String])?[record.id] == record.revision, "Stable revision export")
        let valid = NativeCompletionCommand(id: "sample-command", taskID: "sample-task", reminderID: record.id,
            listID: record.listID, expectedRevision: record.revision, expiresAt: Date().addingTimeInterval(60))
        rejected({ try CompletionPolicy.validate(valid, reminder: record, selectedListIDs: [record.listID], enabled: false, now: Date()) }, "Writeback defaults off")
        let recurring = NativeReminder(id: record.id, externalID: nil, listID: record.listID, title: record.title, notes: record.notes, url: nil, completed: false, completionDate: nil, due: nil, start: nil, priority: 0, modifiedAt: nil, recurring: true)
        let recurringCommand = NativeCompletionCommand(id: valid.id, taskID: valid.taskID, reminderID: recurring.id, listID: recurring.listID, expectedRevision: recurring.revision, expiresAt: valid.expiresAt)
        rejected({ try CompletionPolicy.validate(recurringCommand, reminder: recurring, selectedListIDs: [recurring.listID], enabled: true, now: Date()) }, "Recurring effects not guessed")
        rejected({ try CompletionPolicy.validate(valid, reminder: record, selectedListIDs: [], enabled: true, now: Date()) }, "Unselected list completion denied")
        let stale = NativeCompletionCommand(id: valid.id, taskID: valid.taskID, reminderID: valid.reminderID,
            listID: valid.listID, expectedRevision: "old-revision", expiresAt: valid.expiresAt)
        rejected({ try CompletionPolicy.validate(stale, reminder: record, selectedListIDs: [record.listID], enabled: true, now: Date()) }, "Stale completion denied")
        rejected({ try CompletionPolicy.validate(valid, reminder: record, selectedListIDs: [record.listID], enabled: true, now: valid.expiresAt) }, "Expiry boundary denied")
        do { try await store.complete(valid, selectedListIDs: [record.listID], enabled: false); preconditionFailure("Disabled store write") } catch { passed += 1 }
        let unchanged = try await store.snapshot(selectedListIDs: [record.listID])
        check(!unchanged.reminders[0].completed, "Rejected command preserves record")
        try await store.complete(valid, selectedListIDs: [record.listID], enabled: true)
        let completed = try await store.snapshot(selectedListIDs: [record.listID])
        check(completed.reminders[0].completed && completed.reminders[0].notes == record.notes, "Scoped completion preserves details")
        check(completed.reminders[0].revision != record.revision, "Completion changes revision")
        let local = try CompanionOrigin.validate("http://localhost:8081")
        let remote = try CompanionOrigin.validate("https://example.com")
        check(CompanionOrigin.matches(URL(string: "https://example.com:443/settings"), remote), "Default origin port normalized")
        check(!CompanionOrigin.matches(URL(string: "https://example.com.attacker.test"), remote), "Foreign origin denied")
        check(!CompanionOrigin.matches(URL(string: "http://localhost:8082"), local), "Foreign port denied")
        for value in ["http://example.com", "https://user:password@example.com", "https://example.com?token=sample", "https://example.com/#sample", "https://example.com/path", "file:///tmp/sample", "http://localhost.attacker.test"] {
            rejected({ _ = try CompanionOrigin.validate(value) }, "Unsafe origin denied")
        }
        check(UITestSessionPolicy.allows(environment: ["REA_UI_TEST":"1"], origin: local), "Opt-in exact loopback UI hook")
        check(!UITestSessionPolicy.allows(environment: [:], origin: local), "Normal launches reject UI hook")
        for unsafe in ["https://localhost:8081", "http://127.0.0.1:8081", "http://localhost:8082", "https://example.com", "http://localhost:8081/path", "http://localhost:8081/?sample=1"] {
            check(!UITestSessionPolicy.allows(environment: ["REA_UI_TEST":"1"], origin: URL(string: unsafe)!), "UI session never leaves exact test origin")
        }
        print("Native companion: \(passed) synthetic checks passed. No EventKit or Keychain access.")
    }
}
