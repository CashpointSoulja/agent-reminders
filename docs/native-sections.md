# Original Apple Reminders sections

The account importer preserves section names, their source order, empty sections, and each reminder’s original membership when the source supplies that metadata. It does not infer sections from titles, tags, or notes. Section identifiers are scoped to the provider and list, so identical source IDs in different lists cannot collide.

## Why the iPhone import was flat

The iPhone companion uses public EventKit. The installed `EKCalendar` and `EKReminder` declarations do not provide list sections or manual section membership. The previous web importer also initialized every account list with `sections: []`.

An EventKit-only snapshot now leaves sections **unknown**, rather than claiming the source has no sections. Refreshing from that older format keeps existing sections and memberships. It cannot recover metadata that EventKit never returned.

## Read-only Mac recovery

A separate, authored local helper lives in [`native/ios/mac-sections`](../native/ios/mac-sections/SectionExport.m). It requires a Mac whose native Reminders app has the original lists synced. It uses the installed private ReminderKit interface after public macOS Reminders permission and an explicit owner selection. This is a local compatibility adapter, with no App Store suitability claim. A browser or Cloudflare Worker cannot access EventKit or the local macOS ReminderKit framework.

Build and run the synthetic checks:

```sh
native/ios/mac-sections/build.sh
```

The command creates `work/native-section-export/RemindersSectionExport.app`. It does not launch the helper, read an account, or install anything. The 15 checks exercise only synthetic objects and an owner-only temporary file, which is deleted.

To use the helper:

1. Open that app and read its private-interface notice.
2. Grant the macOS Reminders prompt yourself. No Apple ID credentials are requested.
3. Click **Reveal Private List Names** yourself, then select only the lists you want to recover. Names are masked during automation setup.
4. Preview the original section names, order, and counts.
5. Save the private import outside any Git repository, then use **Accounts → iCloud → Import from iPhone…** in the web app to preview and import it. The file format is shared with the iPhone import.
6. Delete the private export after importing. Save to your own configured private cloud vault if you want cloud persistence.

The helper does not edit Apple Reminders or upload to any server. Files are created with mode `0600`, existing files are not overwritten, and Git directories are refused. It does not request Full Disk Access, open the protected Reminders database, forge entitlements, or bypass an OS permission denial.

## Source mapping and failure behavior

Static inspection of the installed ReminderKit data model establishes these source fields:

| Native source | Imported value |
| --- | --- |
| `REMCDList.sections` (ordered relationship) | `lists[].sections` in source order |
| `REMCDListSection.identifier`, `displayName` | `sections[].id`, `title` |
| `membershipsOfRemindersInSectionsAsData` | List-level original membership; never guessed from row text |
| `sectionIDsOrderingAsData` | Native section ordering |
| `reminderIDsMergeableOrdering` / `_v2_JSON` | Native reminder order |

The helper reads the decoded first-party representation rather than guessing a SQLite or binary blob format:

- `REMStore.fetchListsForEventKitBridgingWithError:` identifies readable native lists.
- `REMStore.fetchListSectionsForListSectionContext:error:` supplies the selected section context.
- `REMListSectionsDataView.fetchListSectionWithReminderID:error:` supplies each selected reminder’s actual section.
- `REMList.reminderIDsOrdering` supplies original reminder order.
- `REMObjectID.uuid` is compared to the public EventKit identifier. Only a real UUID or a matching `x-apple-reminderkit://REMList|REMReminder/UUID` identity is accepted; names are not identity keys.

The installed macOS Reminders executable was identified through REA `inspect-macho`: SHA-256 `0ceffd91dd1062e034194a9fbb57e0ec6f63539606ba82a5ee39e35084f29631`, evidence `ev_2f9b09c2239042cdd5f475db6c1a8f52e7063ee4ab844bb1c83f90d419b1d208`. This is shipped-artifact evidence, not evidence that the owner’s records were exported. Deep REA providers were unavailable; framework selector metadata and the shipped Core Data model supplied the narrower schema observations. No Apple binary, asset, model, or account snapshot is distributed in this repository.

The helper fails closed if a selector/signature changes, access is denied, IDs are ambiguous, membership points outside the selected list, or native ordering does not cover every reminder. It rechecks sections, ordering, and membership after the public EventKit fetch. No partial export is offered. Native subsections or subtasks that the ordering interface cannot represent cause an explicit failure, rather than an invented layout.

**Live status:** the helper has compiled, its 15 synthetic protocol/file checks pass, and its separate macOS Reminders permission prompt has been observed. It is awaiting the owner’s macOS permission. No real account snapshot has been exported. Entitlement acceptance, matching IDs across the owner’s devices, and returned section order versus the native UI remain unverified. Existing iPhone imports still need a genuine section-aware source to recover missing sections.

The ignored `work/native-section-export/section-export-stage.txt` file records only an authored phase or sanitized error code, with mode `0600`. It never contains reminder text, section names, record IDs, or native exception reasons. It can identify a permission/interface blocker without recording a private chooser screenshot.

## Snapshot and refresh contract

The version-1 native snapshot adds optional fields:

```json
{
  "lists": [{"id": "sample-list", "title": "Synthetic List", "writable": true,
    "sections": [{"id": "sample-section", "title": "Synthetic Section"}]}],
  "reminders": [{"id": "sample-reminder", "listID": "sample-list", "sectionID": "sample-section"}]
}
```

This fragment shows the section fields only; a full snapshot must still contain the required timestamp, selection, and reminder values. Omitted `sections` / `sectionID` means unknown; an explicit empty array / `null` means known empty / sectionless. Source order is the array order. Duplicate or foreign section IDs, blank names, more than 200 sections per list, or oversized names reject the whole import.

The existing three-way refresh tracks list `base.sections`, reminder `base.sectionId`, and source reminder `order` in account provenance. It updates unedited source names, membership, and order, keeps local edits, and reports conflicting changes. Removed source sections stay available to retained local reminders or local section edits; unedited, unreferenced removed source sections disappear. A section-aware refresh can repair an earlier flat import using stable native IDs without duplicating reminders. Known UUID/ReminderKit URI aliases preserve existing local row identities.

The private cloud vault must encrypt and retain both the model (`lists[].sections`, `reminders[].sectionId`, reminder array order) and the account provenance. This metadata contains personal section names and identities and must never be stored in a public workspace or committed to Git.
