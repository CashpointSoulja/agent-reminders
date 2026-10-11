import Foundation

@MainActor
private final class FlakyReadbackStore: ReminderStore {
    let isSample = true
    private let base = SampleReminderStore()
    private var failReadback = false
    private(set) var writes = 0
    func requestAccess() async throws {}
    func lists() throws -> [NativeList] { try base.lists() }
    func snapshot(selectedListIDs: Set<String>) async throws -> NativeSnapshot {
        if failReadback { failReadback = false; throw NativeSyncError.conflict }
        return try await base.snapshot(selectedListIDs: selectedListIDs)
    }
    func complete(_ command: NativeCompletionCommand, selectedListIDs: Set<String>, enabled: Bool) async throws {
        try await base.complete(command, selectedListIDs: selectedListIDs, enabled: enabled)
        writes += 1; failReadback = true
    }
}
@MainActor
private final class FailingClearSecrets: NativeSecrets {
    func read() throws -> String? { "synthetic-origin-bound-token" }
    func save(_ token: String) throws {}
    func clear() throws { throw NativeSyncError.unsupported }
}
@main
struct DeviceClientTests {
    @MainActor
    static func main() async throws {
        let origin = try CompanionOrigin.validate("https://synthetic.test")
        let secrets = SampleSecrets(), journal = SampleCommandJournal(), store = SampleReminderStore()
        let snapshot = try await store.snapshot(selectedListIDs: ["sample-list"]), source = snapshot.reminders[0]
        let commandID = "synthetic-command", taskID = "synthetic-task"
        var claimID: String?, ackCount = 0, rejectFirstAck = true, receivedPairHash = false, uploads = 0, serverAcknowledged = false
        func response(_ request: URLRequest, _ object: [String: Any], _ status: Int = 200) throws -> (Data, HTTPURLResponse) {
            (try JSONSerialization.data(withJSONObject: object), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
        let grant: [String: Any] = ["id":"synthetic-device","name":"Synthetic iPhone","lists":[["id":"sample-list","title":"Sample tasks","writable":true]],"activeListIDs":["sample-list"],"writebackListIDs":["sample-list"],"grantVersion":1,"expiresAt":Date().addingTimeInterval(300).timeIntervalSince1970*1000]
        func command() -> [String: Any] {
            ["id":commandID,"taskID":taskID,"reminderID":source.id,"listID":source.listID,"expectedRevision":source.revision,"expiresAt":Date().addingTimeInterval(300).timeIntervalSince1970*1000,"grantVersion":1,"claimID":claimID as Any? ?? NSNull(),"claimExpiresAt":Date().addingTimeInterval(60).timeIntervalSince1970*1000]
        }
        let client = NativeDeviceClient(origin: origin, secrets: secrets, journal: journal, transport: { request in
            let path = request.url!.path
            let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            if path.hasSuffix("/pairings") {
                precondition(request.value(forHTTPHeaderField:"Authorization") == nil)
                let token = try secrets.read()!
                precondition(!(String(data: request.httpBody!, encoding:.utf8)!).contains(token))
                receivedPairHash = (body?["tokenHash"] as? String)?.count == 64
                return try response(request,["pairingId":"synthetic-device","code":"SAMP-TEST","expiresAt":Date().addingTimeInterval(300).timeIntervalSince1970*1000,"pollIntervalSeconds":5],201)
            }
            let storedToken = try secrets.read()!
            precondition(request.value(forHTTPHeaderField:"Authorization") == "Bearer \(storedToken)")
            precondition(request.value(forHTTPHeaderField:"Cookie") == nil)
            if path.hasSuffix("/me") { return try response(request,["device":grant,"revision":1]) }
            if path.hasSuffix("/imports") {
                precondition(request.value(forHTTPHeaderField:"If-Match") == "1")
                precondition(request.value(forHTTPHeaderField:"Idempotency-Key") == "synthetic-import-request")
                precondition(body?["schemaVersion"] as? Int == 1); uploads += 1
                return try response(request,["created":1,"revision":2])
            }
            if path.hasSuffix("/commands") { return try response(request,["commands":serverAcknowledged ? [] : [command()],"revision":3]) }
            if path.hasSuffix("/claim") { claimID = body?["claimID"] as? String; return try response(request,["command":command(),"revision":4]) }
            if path.hasSuffix("/ack") {
                ackCount += 1; serverAcknowledged = true
                if rejectFirstAck { rejectFirstAck=false; throw NativeDeviceError(status:503,message:"Synthetic acknowledgement response lost after server commit") }
                precondition(body?["completed"] as? Bool == true && body?["outcome"] as? String == "applied")
                return try response(request,["receipt":["outcome":"applied"],"revision":5])
            }
            return try response(request,["error":"Synthetic unexpected route"],404)
        })
        _ = try await client.pair(lists:snapshot.lists,name:"Synthetic iPhone")
        precondition(receivedPairHash)
        let active = try await client.activate(); precondition(active)
        try await client.upload(snapshot,key:"synthetic-import-request")
        precondition(uploads == 1)
        let disabled = try await client.finishCommands(store:store,selected:[source.listID],locallyEnabled:false)
        precondition(disabled == 0 && ackCount == 0)
        do { _ = try await client.finishCommands(store:store,selected:[source.listID],locallyEnabled:true); preconditionFailure("Lost acknowledgement must surface") } catch {}
        let changed = try await store.snapshot(selectedListIDs:[source.listID]).reminders[0]
        precondition(changed.completed)
        let pendingJournal = try journal.get(commandID); precondition(pendingJournal?.outcome == "applied")
        let firstRevision = changed.revision
        let finished = try await client.finishCommands(store:store,selected:[source.listID],locallyEnabled:true)
        precondition(finished == 1 && ackCount == 2)
        let finalJournal = try journal.get(commandID); precondition(finalJournal == nil)
        let unchanged = try await store.snapshot(selectedListIDs:[source.listID]).reminders[0]
        precondition(unchanged.revision == firstRevision)
        let flaky = FlakyReadbackStore(), flakySecrets = SampleSecrets(), flakyJournal = SampleCommandJournal()
        try flakySecrets.save("rwd_" + String(repeating: "F", count: 43))
        var flakyAcked = false, flakyClaim: String?
        let flakyClient = NativeDeviceClient(origin: origin, secrets: flakySecrets, journal: flakyJournal, transport: { request in
            var item = command(); item["id"] = "readback-command"; item["claimID"] = flakyClaim as Any? ?? NSNull()
            let path = request.url!.path
            if path.hasSuffix("/me") { return try response(request,["device":grant,"revision":6]) }
            if path.hasSuffix("/commands") { return try response(request,["commands":flakyAcked ? [] : [item],"revision":6]) }
            if path.hasSuffix("/claim") {
                let input = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                flakyClaim = input["claimID"] as? String; item["claimID"] = flakyClaim
                return try response(request,["command":item,"revision":7])
            }
            if path.hasSuffix("/ack") { flakyAcked = true; return try response(request,["receipt":["outcome":"applied"],"revision":8]) }
            return try response(request,["error":"unexpected"],404)
        })
        do { _ = try await flakyClient.finishCommands(store:flaky,selected:[source.listID],locallyEnabled:true); preconditionFailure("Readback failure must remain unresolved") } catch {}
        precondition(flaky.writes == 1 && !flakyAcked)
        let unresolved = try flakyJournal.get("readback-command"); precondition(unresolved != nil && unresolved?.outcome == nil)
        let recovered = try await flakyClient.finishCommands(store:flaky,selected:[source.listID],locallyEnabled:true)
        precondition(recovered == 1 && flakyAcked && flaky.writes == 1)
        let recoveredJournal = try flakyJournal.all(); precondition(recoveredJournal.isEmpty)
        let failedClear = NativeDeviceClient(origin: origin, secrets: FailingClearSecrets(), journal: SampleCommandJournal(), transport: { _ in throw NativeSyncError.unsupported })
        do { try failedClear.clearLocalCredential(); preconditionFailure("Credential cleanup must fail closed") } catch {}
        precondition(failedClear.origin == origin)
        print("Native device client: 11 synthetic protocol/journal checks passed. No EventKit or Keychain access.")
        if CommandLine.arguments.contains("--fixture") {
            let edge = NativeReminder(id:"fixture-URL", externalID:nil, listID:"sample-list", title:"Synthetic café 🍉", notes:"Line 1\nLine 2", url:"https://example.invalid/sample", completed:false, completionDate:nil,
                due:NativeDate(DateComponents(timeZone:TimeZone(identifier:"Europe/London"), year:2026, month:10, day:11, hour:0, minute:0)), start:nil, priority:1, modifiedAt:Date(timeIntervalSince1970:1234567890.123), recurring:false)
            let golden = NativeSnapshot(generatedAt:Date(), sample:true, selectedListIDs:snapshot.selectedListIDs, lists:snapshot.lists, reminders:[source,edge])
            try golden.encoded().write(to: URL(fileURLWithPath: CommandLine.arguments.last!))
        }
    }
}
