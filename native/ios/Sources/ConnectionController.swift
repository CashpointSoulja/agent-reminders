import UIKit

@MainActor
final class ConnectionController: UITableViewController {
    private var store: ReminderStore = SampleReminderStore()
    private var lists: [NativeList] = []
    private var selectedListIDs = Set<String>()
    private var preview: NativeSnapshot?
    private var busy = false
    private var client: NativeDeviceClient?
    private var pairing: NativePairing?
    private var writeback = false
    private var previewKey: String?
    private var status = "Sample mode. No Apple account is connected."
    private let origin: URL
    private let updateOrigin: (URL) -> Void
    private let importLocally: ((NativeSnapshot) async throws -> Void)?

    init(origin: URL, importLocally: ((NativeSnapshot) async throws -> Void)? = nil, updateOrigin: @escaping (URL) -> Void) {
        self.origin = origin; self.updateOrigin = updateOrigin; self.importLocally = importLocally
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = importLocally == nil ? "Device Connection" : "Apple Reminders"
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            self?.preview = nil; self?.dismiss(animated: true)
        })
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "device.close"
        lists = (try? store.lists()) ?? []
        if importLocally == nil { client = try? NativeDeviceClient.make(origin: origin) }
        tableView.accessibilityIdentifier = "device.connection"
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 60
    }
    private func section(_ section: Int) -> Int { importLocally == nil ? section : section + 1 }
    override func numberOfSections(in tableView: UITableView) -> Int { importLocally == nil ? 6 : 3 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch self.section(section) { case 0, 1: return 1; case 2: return max(1, lists.count); case 3: return 1; case 4: return 3; default: return 2 }
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        ["Your server", "Apple Reminders", "Choose lists", "Preview", "Sync", "Agent writeback"][self.section(section)]
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch self.section(section) {
        case 0: return "The web app signs in normally. Device credentials stay in Keychain and are never passed to the web page."
        case 1:
            #if targetEnvironment(simulator)
            return "Simulator builds always use synthetic sample data. Connect Apple Reminders only on your own iPhone."
            #else
            return "Apple requires full Reminders access, even for a preview. Only reminders from lists you select are copied. The preview stays on this device until you confirm an import or upload."
            #endif
        case 2: return "No lists are selected by default. Changing the selection clears the preview."
        case 3: return status + (importLocally == nil ? "" : " Confirmed imports stay on this device unless you enable Cloud Storage. When enabled, the web page encrypts and saves your private copies, keeping two earlier copies for recovery. The companion does not change Apple reminders or send Apple credentials. Restoring a cloud copy does not change Apple reminders. Refresh by selecting and importing a fresh preview.")
        case 4: return pairing.map { "Approve this device on your signed-in server using code \($0.code). No reminder contents are sent by pairing. Then check approval and upload your reviewed preview." } ?? "Pairing shares selected list names for owner approval. Upload sends only the reviewed selected-list preview. Native completion runs only when you choose Sync Task Completions; there is no background execution."
        default: return "Writeback is off until you enable it. Only successfully delegated, unchanged nonrecurring reminders may be completed. Apple may apply its own subtask completion rules; private hierarchy is unavailable. Disconnect revokes this device token without deleting Apple reminders."
        }
    }
    override func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        cell.textLabel?.font = .preferredFont(forTextStyle: .body)
        cell.detailTextLabel?.font = .preferredFont(forTextStyle: .footnote)
        cell.textLabel?.adjustsFontForContentSizeCategory = true
        cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
        cell.isAccessibilityElement = true
        switch section(path.section) {
        case 0:
            cell.textLabel?.text = "Reminders server"; cell.detailTextLabel?.text = origin.absoluteString
            cell.accessoryType = .disclosureIndicator
        case 1:
            cell.textLabel?.text = store.isSample ? "Connect Apple Reminders" : "Use sample data"
            cell.textLabel?.textColor = .systemBlue
            #if targetEnvironment(simulator)
            cell.textLabel?.text = "Sample data only"; cell.selectionStyle = .none
            cell.accessibilityIdentifier = "device.sample.mode"
            #endif
        case 2:
            if lists.isEmpty { cell.textLabel?.text = "No lists available"; cell.selectionStyle = .none }
            else {
                let list = lists[path.row]
                cell.textLabel?.text = list.title
                cell.detailTextLabel?.text = list.writable ? nil : "Read only"
                cell.accessoryType = selectedListIDs.contains(list.id) ? .checkmark : .none
                cell.accessibilityTraits = selectedListIDs.contains(list.id) ? [.button, .selected] : .button
                if store.isSample { cell.accessibilityIdentifier = "device.sample.list" }
                cell.accessibilityValue = selectedListIDs.contains(list.id) ? "Selected" : "Not selected"
            }
        case 3:
            cell.textLabel?.text = "Preview Selected Reminders"; cell.textLabel?.textColor = .systemBlue
            cell.accessibilityIdentifier = "device.preview"
            cell.isUserInteractionEnabled = !busy && !selectedListIDs.isEmpty
            cell.accessibilityTraits = cell.isUserInteractionEnabled ? .button : [.button, .notEnabled]
            if busy || selectedListIDs.isEmpty { cell.textLabel?.textColor = .secondaryLabel }
        case 4:
            if path.row == 0 { cell.textLabel?.text = pairing == nil ? "Pair Selected Lists" : "Check Pairing Approval" }
            else if path.row == 1 { cell.textLabel?.text = "Upload Preview" }
            else { cell.textLabel?.text = "Sync Task Completions" }
            cell.textLabel?.textColor = .systemBlue
        default:
            if path.row == 0 {
                cell.textLabel?.text = "Task completion writeback"; cell.detailTextLabel?.text = writeback ? "On for selected writable lists" : "Off"
                cell.selectionStyle = .none
                let toggle = UISwitch(); toggle.isOn = writeback; toggle.isEnabled = client?.grant != nil && !busy
                toggle.addTarget(self, action: #selector(toggleWriteback(_:)), for: .valueChanged)
                toggle.accessibilityLabel = "Task completion writeback"; toggle.accessibilityIdentifier = "device.writeback"
                cell.isAccessibilityElement = false; cell.accessoryView = toggle
            } else {
                cell.textLabel?.text = "Disconnect"; cell.textLabel?.textColor = .systemRed
            }
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt path: IndexPath) {
        tableView.deselectRow(at: path, animated: true)
        guard !busy else { return }
        switch section(path.section) {
        case 0: editOrigin()
        case 1: connect()
        case 2:
            guard !lists.isEmpty else { return }
            let id = lists[path.row].id
            if selectedListIDs.contains(id) { selectedListIDs.remove(id) } else { selectedListIDs.insert(id) }
            preview = nil; previewKey = nil; writeback = false; tableView.reloadData()
        case 3: preparePreview()
        case 4: syncAction(path.row)
        default: if path.row == 1 { disconnect() }
        }
    }
    private func connect() {
        #if targetEnvironment(simulator)
        return
        #else
        if !store.isSample {
            if importLocally == nil { disconnect() }
            else {
                preview = nil; previewKey = nil; selectedListIDs.removeAll()
                store = SampleReminderStore(); lists = (try? store.lists()) ?? []
                status = "Disconnected locally. Apple reminders were not changed."; tableView.reloadData()
            }
            return
        }
        let alert = UIAlertController(title: "Connect Apple Reminders?", message:
            "iOS will ask for full Reminders access. You choose which lists to preview. The preview stays on this device until you confirm an import or upload, and writeback stays off.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Continue", style: .default) { [weak self] _ in
            guard let self else { return }
            self.busy = true; self.tableView.reloadData()
            Task { @MainActor in
                defer { self.busy = false; self.tableView.reloadData() }
                do {
                    let apple = AppleReminderStore()
                    try await apple.requestAccess()
                    self.lists = try apple.lists(); self.store = apple
                    self.selectedListIDs.removeAll(); self.preview = nil
                    apple.onChange = { [weak self] in
                        guard let self else { return }
                        self.preview = nil; self.status = "Apple Reminders changed. Preview again."
                        self.tableView.reloadData()
                    }
                    self.status = "Connected for local preview. No copies are imported or saved until you confirm."
                } catch { self.showError(error) }
            }
        })
        present(alert, animated: true)
        #endif
    }
    private func preparePreview() {
        guard !selectedListIDs.isEmpty else { return }
        busy = true; tableView.reloadData()
        Task { @MainActor in
            defer { busy = false; tableView.reloadData() }
            do {
                let selection = selectedListIDs
                let snapshot = try await store.snapshot(selectedListIDs: selection)
                guard selection == selectedListIDs else { return }
                if importLocally != nil { _ = try LocalImportPolicy.encoded(snapshot) }
                preview = snapshot; let key = UUID().uuidString; previewKey = key
                status = "Preview contains \(snapshot.reminders.count) reminders from \(snapshot.lists.count) selected lists. No copies are imported or saved until you confirm."
                let back = UIBarButtonItem(title: title, style: .plain, target: nil, action: nil)
                back.accessibilityIdentifier = "device.preview.back"
                navigationItem.backBarButtonItem = back
                let reviewedSnapshot: (() async throws -> NativeSnapshot)? = importLocally == nil ? nil : { [weak self] in
                    guard let self, self.preview != nil, self.previewKey == key,
                          self.selectedListIDs == Set(snapshot.selectedListIDs) else { throw NativeSyncError.conflict }
                    let current = try await self.store.snapshot(selectedListIDs: self.selectedListIDs)
                    guard self.preview != nil, self.previewKey == key,
                          self.selectedListIDs == Set(current.selectedListIDs),
                          current.lists == snapshot.lists, current.revisions == snapshot.revisions else { throw NativeSyncError.conflict }
                    _ = try LocalImportPolicy.encoded(current)
                    return current
                }
                let localAction: (() async throws -> Void)? = importLocally.map { deliver in
                    {
                        guard let reviewedSnapshot else { throw NativeSyncError.invalidSnapshot }
                        let current = try await reviewedSnapshot()
                        try await deliver(current)
                    }
                }
                let controller = PreviewController(snapshot: snapshot, origin: origin, importLocally: localAction, exportLocally: reviewedSnapshot)
                navigationController?.pushViewController(controller, animated: true)
            } catch { showError(error) }
        }
    }
    private func editOrigin() {
        let alert = UIAlertController(title: "Reminders Server", message: "Use your personal HTTPS instance. Localhost is allowed for isolated development. Changing servers clears this token locally; revoke the old device in its server Device Settings if still listed.", preferredStyle: .alert)
        alert.addTextField { field in
            field.text = self.origin.absoluteString; field.keyboardType = .URL
            field.autocapitalizationType = .none; field.autocorrectionType = .no
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open", style: .default) { [weak self, weak alert] _ in
            guard let self else { return }
            do {
                let next = try CompanionOrigin.validate(alert?.textFields?.first?.text ?? "")
                guard let client = self.client else { throw NativeSyncError.unsupported }
                try client.clearLocalCredential()
                self.updateOrigin(next); self.preview = nil; self.dismiss(animated: true)
            } catch { self.showError(error) }
        })
        present(alert, animated: true)
    }
    private func disconnect() {
        busy = true
        Task { @MainActor in
            defer { busy = false; tableView.reloadData() }
            do {
                try await client?.disconnect()
                preview = nil; previewKey = nil; selectedListIDs.removeAll(); pairing = nil; writeback = false
                store = SampleReminderStore(); lists = try store.lists()
                status = "Disconnected. Apple reminders were not deleted."
            } catch { showError(error) }
        }
    }
    private func syncAction(_ row: Int) {
        guard let client else { return }
        if row == 0 && pairing == nil {
            guard let preview else { status = "Select lists and review a preview before pairing."; tableView.reloadData(); return }
            let alert = UIAlertController(title: "Pair Selected Lists?", message: "Share the names of \(preview.lists.count) selected lists with your personal server for approval. No reminder contents are sent yet.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
            alert.addAction(UIAlertAction(title: "Pair", style: .default) { [weak self] _ in
                self?.performSync { self?.pairing = try await client.pair(lists: preview.lists, name: "My iPhone"); self?.status = "Pairing pending. Approve the displayed code on your server." }
            })
            present(alert, animated: true); return
        }
        if row == 0 {
            performSync { [weak self] in
                guard let self else { return }
                let active = try await client.activate()
                self.status = active ? "Device approved. Review and upload your selected preview." : "Approval is still pending."
                if active { self.writeback = !(client.grant?.writebackListIDs.isEmpty ?? true) }
            }; return
        }
        if row == 1 {
            guard let preview, let previewKey else { status = "Create a fresh preview first."; tableView.reloadData(); return }
            let alert = UIAlertController(title: "Upload \(preview.reminders.count) Reminders?", message: "Upload this reviewed selected-list preview to your personal server. No Apple reminders are changed by an upload.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
            alert.addAction(UIAlertAction(title: "Upload", style: .default) { [weak self] _ in
                self?.performSync {
                    try await client.configure(selected: Set(preview.selectedListIDs), writeback: self?.writeback ?? false)
                    try await client.upload(preview, key: previewKey)
                    self?.status = "Selected preview uploaded. Apple reminders were not changed."
                }
            })
            present(alert, animated: true); return
        }
        performSync { [weak self] in
            guard let self else { return }
            let count = try await client.finishCommands(store: self.store, selected: self.selectedListIDs, locallyEnabled: self.writeback)
            self.status = "\(count) task completion receipts synced."
        }
    }
    private func performSync(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }; busy = true; tableView.reloadData()
        Task { @MainActor in
            defer { busy = false; tableView.reloadData() }
            do { try await operation() }
            catch {
                if let problem = error as? NativeDeviceError, !problem.conflicts.isEmpty, let preview, let previewKey {
                    reviewConflicts(problem.conflicts, preview: preview, key: previewKey)
                } else { showError(error) }
            }
        }
    }
    private func reviewConflicts(_ conflicts: [NativeImportConflict], preview: NativeSnapshot, key: String,
                                 choices: [NativeConflictResolution] = []) {
        guard let first = conflicts.first else {
            performSync { [weak self] in
                guard let self, let client = self.client else { return }
                try await client.upload(preview, key: key, resolutions: choices)
                self.status = "Reviewed conflict choices uploaded. Apple reminders were not changed."
            }; return
        }
        guard first.kind == "reminder", let sourceRevision = first.sourceRevision,
              let webFingerprint = first.webFingerprint, let apple = first.apple, let cloud = first.cloud else {
            status = "A list or deleted cloud copy needs manual review on your server. Nothing was imported."
            showError(NativeDeviceError(status: 409, message: status)); return
        }
        func summary(_ value: NativeConflictSummary) -> String {
            "\(value.title)\n\(value.completed ? "Completed" : "Open") · \(value.priority)\n\(value.dueDate ?? "No date") \(value.dueTime ?? "") \(value.timeZone)\n\(String(value.notes.prefix(300)))\n\(String(value.url.prefix(300)))"
        }
        let detail = "Apple: \(summary(apple))\n\nServer: \(summary(cloud))\n\nChoose which version to keep in the web app. Apple reminders are not edited."
        let alert = UIAlertController(title: "Reminder Changed in Both Places", message: detail, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        for (title, choice) in [("Keep Server", "keepWeb"), ("Use Apple", "useApple")] {
            alert.addAction(UIAlertAction(title: title, style: .default) { [weak self, weak alert] _ in
                let resolution = NativeConflictResolution(sourceID: first.sourceID, sourceRevision: sourceRevision, webFingerprint: webFingerprint, choice: choice)
                alert?.dismiss(animated: true) { [weak self] in self?.reviewConflicts(Array(conflicts.dropFirst()), preview: preview, key: key, choices: choices + [resolution]) }
            })
        }
        present(alert, animated: true)
    }
    @objc private func toggleWriteback(_ toggle: UISwitch) {
        let wanted = toggle.isOn; toggle.setOn(writeback, animated: false)
        guard let client else { return }
        let apply = { [weak self] in
            self?.performSync {
                guard let self else { return }
                try await client.configure(selected: self.selectedListIDs, writeback: wanted)
                self.writeback = wanted
                self.status = wanted ? "Writeback enabled for selected writable lists." : "Writeback disabled."
            }
        }
        if !wanted { apply(); return }
        let alert = UIAlertController(title: "Enable Task Completion Writeback?", message: "Successful assigned tasks may complete unchanged nonrecurring reminders in your selected writable Apple lists. Apple may apply its own subtask completion rules. No reminders are created or deleted.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Enable", style: .default) { _ in apply() })
        present(alert, animated: true)
    }
    private func showError(_ error: Error) {
        status = (error as? NativeSyncError)?.errorDescription ?? (error as? NativeDeviceError)?.message ?? "The operation outcome is unavailable. Retry the same operation to reconcile its receipt."
        let alert = UIAlertController(title: "Connection", message: status, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default)); present(alert, animated: true)
    }
}

@MainActor
private final class PreviewController: UITableViewController {
    private let snapshot: NativeSnapshot
    private let origin: URL
    private let importLocally: (() async throws -> Void)?
    private let exportLocally: (() async throws -> NativeSnapshot)?
    private var importing = false
    init(snapshot: NativeSnapshot, origin: URL, importLocally: (() async throws -> Void)? = nil,
         exportLocally: (() async throws -> NativeSnapshot)? = nil) {
        self.snapshot = snapshot; self.origin = origin; self.importLocally = importLocally
        self.exportLocally = exportLocally; super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "Import Preview"
        tableView.accessibilityIdentifier = "device.preview.screen"
        tableView.accessibilityValue = "\(snapshot.reminders.count) reminders"
        if importLocally != nil {
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Use on This Device", style: .done, target: self, action: #selector(confirmLocalImport))
            navigationItem.rightBarButtonItem?.accessibilityIdentifier = "device.import.local"
        } else if snapshot.sample {
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Export Sample", style: .plain, target: self, action: #selector(exportSample))
        }
        if exportLocally != nil {
            let export = UIBarButtonItem(title: "Export for Browser", style: .plain, target: self, action: #selector(confirmBrowserExport))
            export.accessibilityIdentifier = "device.import.export"
            toolbarItems = [UIBarButtonItem(systemItem: .flexibleSpace), export, UIBarButtonItem(systemItem: .flexibleSpace)]
        }
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setToolbarHidden(exportLocally == nil, animated: animated)
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        navigationController?.setToolbarHidden(true, animated: animated)
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { snapshot.reminders.count }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        "Local preview only. \(snapshot.sample ? "Synthetic sample data; no Apple account is read. " : "")\(snapshot.unsupportedFeatures.contains("sections") ? "Apple’s public Reminders API does not expose sections; use the section-aware Mac export to retain them. " : "Original sections and membership are included. ")Tags, subtasks, flags, photos, shopping categories, assignments, smart-list rules, recurrence rules and alarms are not exported by this foundation."
    }
    override func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
        let record = snapshot.reminders[path.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.accessibilityIdentifier = "device.preview.reminder.\(path.row)"
        cell.textLabel?.text = record.title; cell.textLabel?.numberOfLines = 0
        cell.imageView?.image = UIImage(systemName: record.completed ? "checkmark.circle.fill" : "circle")
        let list = snapshot.lists.first { $0.id == record.listID }
        let section = list?.sections?.first { $0.id == record.sectionID }
        cell.detailTextLabel?.text = [list?.title, section?.title].compactMap { $0 }.joined(separator: " · ")
        cell.selectionStyle = .none
        return cell
    }
    @objc private func confirmLocalImport() {
        guard let importLocally, !importing else { return }
        let alert = UIAlertController(title: "Use \(snapshot.reminders.count) Reminders on This Device?", message:
            "Share this reviewed selection with the web page at \(origin.absoluteString). That page can read these copies. In this app, confirmed imports stay on this device unless you enable Cloud Storage. When enabled, the page encrypts and saves your private copies, keeping two earlier copies for recovery. Other instances may use different storage settings. The companion does not change Apple reminders or send Apple credentials. Restoring a cloud copy does not change Apple reminders.\(snapshot.sample ? " These are fictional sample reminders." : "")", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Use on This Device", style: .default) { [weak self] _ in
            guard let self else { return }
            self.importing = true; self.navigationItem.rightBarButtonItem?.isEnabled = false
            self.navigationItem.hidesBackButton = true; self.navigationController?.isModalInPresentation = true
            Task { @MainActor in
                defer {
                    self.importing = false; self.navigationItem.rightBarButtonItem?.isEnabled = true
                    self.navigationItem.hidesBackButton = false; self.navigationController?.isModalInPresentation = false
                }
                do { try await importLocally(); self.dismiss(animated: true) }
                catch {
                    let message = (error as? NativeSyncError)?.errorDescription ?? "The local import could not finish. Start a fresh preview."
                    let failure = UIAlertController(title: "Import", message: message, preferredStyle: .alert)
                    failure.addAction(UIAlertAction(title: "OK", style: .default)); self.present(failure, animated: true)
                }
            }
        })
        present(alert, animated: true)
    }
    @objc private func confirmBrowserExport() {
        guard let exportLocally, !importing else { return }
        let alert = UIAlertController(title: "Export Selected Reminders?", message:
            "Save a JSON file containing this reviewed selection. In Safari, open Reminders → Accounts → iCloud → Import from iPhone and choose that file. The file contains reminder text; choose a private location and delete it after importing. Apple reminders are not changed.\(snapshot.sample ? " This export contains fictional sample data." : "")", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Export", style: .default) { [weak self] _ in
            guard let self else { return }
            self.importing = true; self.navigationItem.rightBarButtonItem?.isEnabled = false
            self.navigationItem.hidesBackButton = true; self.navigationController?.isModalInPresentation = true
            Task { @MainActor in
                defer {
                    self.importing = false; self.navigationItem.rightBarButtonItem?.isEnabled = true
                    self.navigationItem.hidesBackButton = false; self.navigationController?.isModalInPresentation = false
                }
                var temporaryDirectory: URL?
                do {
                    let current = try await exportLocally()
                    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ReminderImport-\(UUID().uuidString)", isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    temporaryDirectory = directory
                    let file = directory.appendingPathComponent("reminders-import.json")
                    try LocalImportPolicy.encoded(current).write(to: file, options: [.atomic, .completeFileProtection])
                    let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                    share.popoverPresentationController?.barButtonItem = self.toolbarItems?[1]
                    share.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: directory) }
                    self.present(share, animated: true)
                } catch {
                    if let temporaryDirectory { try? FileManager.default.removeItem(at: temporaryDirectory) }
                    let failure = UIAlertController(title: "Export", message: (error as? NativeSyncError)?.errorDescription ?? "The selected preview could not be exported. Try a fresh preview.", preferredStyle: .alert)
                    failure.addAction(UIAlertAction(title: "OK", style: .default)); self.present(failure, animated: true)
                }
            }
        })
        present(alert, animated: true)
    }
    @objc private func exportSample() {
        guard snapshot.sample, let data = try? snapshot.encoded(), let json = String(data: data, encoding: .utf8) else { return }
        let share = UIActivityViewController(activityItems: [json], applicationActivities: nil)
        share.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItem
        present(share, animated: true)
    }
}
