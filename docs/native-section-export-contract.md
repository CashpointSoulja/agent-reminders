# Native section export: static evidence

This investigation has **not established a lossless, supported Copy/export contract** for Apple Reminders sections. The installed app has identity-bearing reminder and section pasteboard types, but their serialized payloads and source section metadata remain unknown. Do not build an importer that guesses those fields or matches reminder titles.

Shipped application metadata was inspected, followed by a narrowly authorized, synthetic object-ID constructor test. No clipboard, account database, Apple events, native UI, real reminder records, or credentials were accessed. This document contains authored observations, not Apple code or copied data.

## Artifact and evidence

The inspected executable is `/System/Applications/Reminders.app/Contents/MacOS/Reminders`, version 7.0 / build 3976. REA `inspect-macho` identifies SHA-256 `0ceffd91dd1062e034194a9fbb57e0ec6f63539606ba82a5ee39e35084f29631` and evidence `ev_2f9b09c2239042cdd5f475db6c1a8f52e7063ee4ab844bb1c83f90d419b1d208`. The same identity appears in the earlier retained static inspection. The arm64e build metadata specifies macOS 26.5. Imported Swift symbol signatures were demangled with the installed `swift-demangle`; they are interfaces, not recovered method bodies.

Reproduction uses the owner-requested CLI, with no REA MCP or setup:

```sh
npx -y rea-agents@6.3.0 inspect-macho /System/Applications/Reminders.app/Contents/MacOS/Reminders --format json
```

The supplemental sources are that app's `Contents/Info.plist`, `Contents/Resources/Reminders.sdef`, static executable strings, and the existing account-free ReminderKit class/property metadata inspection. The private framework is supplied by the system shared cache; there is no ordinary standalone `Versions/A/ReminderKit` file at the inspected path. No decompiled pasteboard implementation is available in this evidence. The synthetic test below invokes only exact-checked object-ID constructors/accessors in the installed framework; it creates no `REMStore` and makes no account request.

## Copy and pasteboard

The app imports these interfaces from `RemindersUICore`:

| Observed interface | What it establishes | What it does not establish |
| --- | --- | --- |
| `TTRMReminderPasteboardItem.objectID`, `.accountID`, `.reminderFromCache` | Internal reminder drag/pasteboard items can retain object and account identity. | The actual pasteboard type identifier, encoding, lifetime, or whether ordinary Copy writes this type. |
| `TTRMSectionPasteboardItem.init(section: TTRSection)` | A distinct internal section pasteboard item exists. | That a user can export a whole section, its contents, name, membership, or order with Copy. |
| `TTRReminderCopyPasteItem.Reminder.init(reminder: REMReminder_Codable, children: [REMReminder_Codable])` | The Copy model represents a reminder and its children. | The encoded keys or whether source list/section identity survives serialization. |
| `TTRRemindersListInteractorType.paste(_:in:after:with:updateProperties:)` | Paste receives the destination `REMList`, optional preceding reminder, and optional `TTRSectionID` separately. | That source section context is included in the Copy item. |
| `TTRMRemindersListPasteboardContentImporter.reminders(NSPasteboard)` and `.possiblePasteboardTypesToRead` | A native pasteboard reader exists. | A portable, documented file/export format. |

The executable contains `pasteboardPropertyListForType:` at whole-file offset `0x47dadd`, `writableTypesForPasteboard:` at `0x486d91`, and `NSPasteboardWriting` at `0x4959da`. These are dispatch/protocol names, not evidence of a particular returned property list.

**Inference:** internal drag items may be useful identity anchors in a later owner-driven, reviewed export. Ordinary Copy cannot currently be accepted as a source of original section membership or ordering. A reminder Copy model and a separate destination section parameter are insufficient proof either way.

## Links and object identity

`Info.plist` registers the `x-apple-reminderkit` URL scheme. The executable contains `x-apple-reminderkit://` at `0x48ac10` and the legacy-looking `x-apple-reminder://` at `0x4906b0`; the second string alone does not establish a registered or supported scheme.

The app imports `ReminderKitInternal.REMNavigationSpecifier.url`, its failable URL initializer, and separate enum cases for a list, reminder, section, and smart-list section, each taking a `REMObjectID`. The section navigation state includes `showExpanded` and `none`. Existing ReminderKit metadata also declares `REMObjectID.uuid: NSUUID`, `.entityName: NSString`, `.urlRepresentation: NSURL`, and `objectIDWithURL:`.

**Observation:** native navigation distinguishes section, list, and reminder identities. **Unknown:** `REMNavigationSpecifier`'s richer URL grammar, whether a supported user action exposes a section URL, and whether those identities match public EventKit identifiers across the owner's devices. A navigation link alone carries no established section name, reminder membership, or ordered contents. Imported Swift enum case names do not provide a safe callable Objective-C ABI; none were invoked.

### Synthetic object-ID URL proof

On 2026-10-12, a Foundation-only, in-process probe used the fixed fake UUID `00000000-0000-0000-0000-000000000001`. Every call was checked against the inspected Objective-C method encoding before being invoked through `NSInvocation`:

| Method | Exact encoding |
| --- | --- |
| `+objectIDWithUUID:entityName:` | `@32@0:8@16@24` |
| `-urlRepresentation` | `@16@0:8` |
| `+objectIDWithURL:` | `@24@0:8@16` |
| `-uuid`, `-entityName` | `@16@0:8` |

The fake `REMList`, `REMReminder`, and `REMListSection` objects returned these URI shapes respectively:

```text
x-apple-reminderkit://REMList/<UUID>
x-apple-reminderkit://REMReminder/<UUID>
x-apple-reminderkit://REMListSection/<UUID>
```

All three URI roundtrips retained the same fake UUID and entity. This establishes the **object-ID representation** on this installed system. It does not prove a URL opens the intended native screen, exports metadata, or matches an existing EventKit record. No URL was opened. Probe code and its synthetic results remain in ignored, owner-only `work/native-section-export-contract`; no framework or account data is distributed.

## Section lookup error contract

An account-free metadata probe establishes exported `REMErrorDomain` as `com.apple.reminderkit` on the installed build. A separate synthetic test invokes only named `REMError` factories, with checked method encodings and a fixed fake reminder object ID or authored test text. It reads only the returned error's domain and numeric code, never its description, user info, or underlying errors. No `REMStore`, permissions/client configuration, or account request is involved.

| Named factory | Observed `com.apple.reminderkit` code |
| --- | --- |
| `noSuchUserDefinedSectionForReminderWithObjectID:` | `-3009` |
| `noSuchObjectErrorWithObjectID:` | `-3000` |
| `unauthorizedErrorWithMissingEntitlement:` | `-1000` |
| `notSupportedError` | `-1006` |
| `invalidParameterErrorWithDescription:` | `-4000` |
| `xpcPerformerUnavailableErrorWithDescription:` | `-5000` |

The one-object factories have encoding `@24@0:8@16`; `notSupportedError` has `@16@0:8`. Six exact factory/domain/code checks passed. This proves `-3009` is used by the **no user-defined section for a reminder** factory, rather than the named missing-entitlement or unsupported factories on this build. It does not prove which helper operation produced any particular live error. The helper's generic `native-domain` label alone also does not establish the real error domain.

The inspected `REMListSectionContext` interface declares `list: REMList`, `initWithList:`, and `hasSections`; the account-capability interface declares `supportsSections`. Those declarations do not explain all request preconditions or prove an account supports them.

**Implementation boundary:** only an exact domain/code match returned by a selected reminder's section-membership lookup could potentially represent sectionless membership. The caller must first distinguish section enumeration, ordering, reminder fetch, and membership lookup with safe authored stage markers. An error from another stage must keep the export closed; never turn all `-3009` results into empty sections or retry through a different client identity. There is no entitlement or platform bypass in this investigation.

The app declares document type `com.apple.reminders.list`, but provides no filename extension or export encoder in that declaration. Registration as a document handler is not proof that a current Export command writes a usable list snapshot.

## Supported scripting boundary

The shipped `Reminders.sdef` declares read-only text `id` properties on lists and reminders. Reminder `container` can be a list or reminder, so the scripting interface can represent a parent reminder. The dictionary contains **no section class, section property, or section export command**. Its `show` command displays a list or reminder. Its text file-format enumerator is explicitly marked as required Cocoa Scripting boilerplate; it does not establish a lossless export capability.

Thus scripting can potentially provide identity and parentage with separate owner-authorized access, but this declared interface cannot provide section membership/order. No Apple events were sent in this investigation.

## Acceptance before implementation

The existing section-aware import contract remains the target; see [native-sections.md](native-sections.md). A new native export source must establish all of these from original metadata:

1. Selected list and reminder IDs that match the existing import without title-based matching.
2. Ordered section IDs and names, including empty and sectionless sections.
3. Every selected reminder's actual section membership and manual order, plus parentage.
4. Explicit unknown fields where metadata is unavailable, with complete validation before changing a local copy.

No candidate in this pass meets all four conditions. Clipboard serialization, a supported user-facing section-copy action, and cross-device identity remain untested. Keep the recovery gap open; do not substitute links, flat text, or fabricated section mappings for the original structure.
