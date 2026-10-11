import Foundation
import EventKit

@MainActor
protocol ReminderStore {
    var isSample: Bool { get }
    func requestAccess() async throws
    func lists() throws -> [NativeList]
    func snapshot(selectedListIDs: Set<String>) async throws -> NativeSnapshot
    func complete(_ command: NativeCompletionCommand, selectedListIDs: Set<String>, enabled: Bool) async throws
}

@MainActor
final class SampleReminderStore: ReminderStore {
    let isSample = true
    private let list = NativeList(id: "sample-list", title: "Sample tasks", writable: true)
    private var reminders = [NativeReminder(id: "sample-reminder", externalID: nil, listID: "sample-list",
        title: "Prepare a sample report", notes: "Synthetic data. No Apple account is connected.", url: nil,
        completed: false, completionDate: nil, due: nil, start: nil, priority: 0, modifiedAt: nil, recurring: false)]
    func requestAccess() async throws {}
    func lists() throws -> [NativeList] { [list] }
    func snapshot(selectedListIDs: Set<String>) async throws -> NativeSnapshot {
        guard !selectedListIDs.isEmpty, selectedListIDs.isSubset(of: [list.id]) else { throw NativeSyncError.noLists }
        return NativeSnapshot(generatedAt: Date(), sample: true, selectedListIDs: selectedListIDs.sorted(),
            lists: [list], reminders: reminders)
    }
    func complete(_ command: NativeCompletionCommand, selectedListIDs: Set<String>, enabled: Bool) async throws {
        guard let index = reminders.firstIndex(where: { $0.id == command.reminderID }) else { throw NativeSyncError.missingReminder }
        try CompletionPolicy.validate(command, reminder: reminders[index], selectedListIDs: selectedListIDs, enabled: enabled, now: Date())
        reminders[index].completed = true
        reminders[index].completionDate = Date()
    }
}

@MainActor
final class AppleReminderStore: ReminderStore {
    let isSample = false
    private let eventStore = EKEventStore()
    private var changeObserver: NSObjectProtocol?
    var onChange: (() -> Void)?
    private var generation = 0

    init() {
        changeObserver = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged,
            object: eventStore, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.generation += 1
                    self?.onChange?()
                }
            }
    }
    deinit { if let changeObserver { NotificationCenter.default.removeObserver(changeObserver) } }

    func requestAccess() async throws {
        let granted = try await eventStore.requestFullAccessToReminders()
        guard granted else { throw NativeSyncError.permission }
    }
    private func requireAccess() throws {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { throw NativeSyncError.permission }
    }
    func lists() throws -> [NativeList] {
        try requireAccess()
        return eventStore.calendars(for: .reminder).map {
            NativeList(id: $0.calendarIdentifier, title: $0.title, writable: $0.allowsContentModifications)
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    func snapshot(selectedListIDs: Set<String>) async throws -> NativeSnapshot {
        try requireAccess()
        guard !selectedListIDs.isEmpty else { throw NativeSyncError.noLists }
        let calendars = eventStore.calendars(for: .reminder).filter { selectedListIDs.contains($0.calendarIdentifier) }
        guard calendars.count == selectedListIDs.count else { throw NativeSyncError.noLists }
        let predicate = eventStore.predicateForReminders(in: calendars)
        let beforeFetch = generation
        let reminders: [EKReminder] = try await withCheckedThrowingContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { result in
                guard let result else { continuation.resume(throwing: NativeSyncError.unsupported); return }
                continuation.resume(returning: result)
            }
        }
        try requireAccess()
        guard beforeFetch == generation else { throw NativeSyncError.conflict }
        guard Set(reminders.map(\.calendarItemIdentifier)).count == reminders.count else { throw NativeSyncError.conflict }
        guard reminders.allSatisfy({ selectedListIDs.contains($0.calendar.calendarIdentifier) }) else {
            throw NativeSyncError.noLists
        }
        return NativeSnapshot(generatedAt: Date(), sample: false, selectedListIDs: selectedListIDs.sorted(),
            lists: calendars.map { NativeList(id: $0.calendarIdentifier, title: $0.title, writable: $0.allowsContentModifications) },
            reminders: reminders.map(Self.record).sorted { $0.id < $1.id })
    }
    func complete(_ command: NativeCompletionCommand, selectedListIDs: Set<String>, enabled: Bool) async throws {
        guard enabled else { throw NativeSyncError.writebackDisabled }
        guard selectedListIDs.contains(command.listID) else { throw NativeSyncError.noLists }
        try requireAccess()
        guard let reminder = eventStore.calendarItem(withIdentifier: command.reminderID) as? EKReminder,
              reminder.refresh(), reminder.calendar.allowsContentModifications else { throw NativeSyncError.missingReminder }
        try CompletionPolicy.validate(command, reminder: Self.record(reminder), selectedListIDs: selectedListIDs,
            enabled: enabled, now: Date())
        if !reminder.isCompleted {
            reminder.isCompleted = true
            try eventStore.save(reminder, commit: true)
        }
    }
    private static func record(_ reminder: EKReminder) -> NativeReminder {
        NativeReminder(id: reminder.calendarItemIdentifier, externalID: reminder.calendarItemExternalIdentifier,
            listID: reminder.calendar.calendarIdentifier, title: reminder.title ?? "", notes: reminder.notes,
            url: reminder.url?.absoluteString, completed: reminder.isCompleted, completionDate: reminder.completionDate,
            due: reminder.dueDateComponents.map { NativeDate($0, reminderTimeZone: reminder.timeZone) }, start: reminder.startDateComponents.map { NativeDate($0, reminderTimeZone: reminder.timeZone) },
            priority: reminder.priority, modifiedAt: reminder.lastModifiedDate, recurring: reminder.hasRecurrenceRules)
    }
}
