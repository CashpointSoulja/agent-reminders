# User guide

The public playground starts with fictional reminders and browser-local copies. **More → Accounts** imports selected account records; **More → Cloud Storage** explicitly saves those copies in a separate private encrypted vault. The owner/agent API remains a separately self-hosted service and is disabled on the public playground.

Current scoped acceptance: the selected Mac preview validates original sections/membership/order and UUID mapping. The owner handled the private export/phone import and reported **“Sections imported correctly”**, then **“Saved to Cloud.”** Those phone results are USER-ATTESTED, not agent physical/export/key/cloud-body readback. See [latest acceptance](parity/native-section-preview-2026-10-12.json).

For provider consent, selected previews/manual refresh and setup, follow [account linking](account-linking.md). Clearing browser storage removes local copies and any remembered cloud code; keep the code privately first. Disconnecting leaves local copies intact. Calendar/iCloud copies and cloud restoration do not update source accounts.

## Capture and organise

Create a list from Home. Choose its name, colour, icon or emoji and list type. Standard lists support manual organisation; shopping lists use an English vocabulary to suggest sections. Unknown items stay in Others and can be moved manually.

Add a reminder to the selected list. Open its Details to edit notes, URL, tags, date/time, repeat pattern, priority and flag. Date and time are stored values; setting them does not establish an OS notification or background alarm.

Use Today, Scheduled, All, Flagged and other smart views to find reminders. Search narrows visible results. A reminder's list and tags remain available through its editing flow.

## Subtasks

Long-press and drag a row to reorder it. Drop onto another row to nest it as a subtask, or drag a subtask out to remove its parent relationship. A parent shows a chevron; tap it to expand or collapse. A collapsed parent shows its child count.

Desktop keyboard and pointer behaviour are supported where implemented, but exact Apple gesture timing and motion remain in progress.

## Templates and attachments

Save a list as a template and create a new independent list from it. Template editing can change reminder fields and attachment copies. Cancelling an editor preserves the saved template. On a self-hosted instance, explicit template sharing exposes only the shared template snapshot, not workspace or agent/device authority.

Private photo/file upload needs the server's R2 binding. Supported uploads are PNG, JPEG, WebP, PDF and plain text, up to five MiB each. Downloads remain authenticated. The browser-local playground is a limited preview; use your own instance for server attachment behaviour.

## Bring an agent

On an instance with the agent feature enabled:

1. Open `/settings/agents` and register your runtime.
2. Issue a scoped expiring token and configure it privately in that runtime. The value is shown only once.
3. Assign a reminder to the agent and write clear completion criteria. Explicitly include subtasks if the task needs them.
4. The runtime claims and performs only its assigned scope, then reports verification evidence.
5. A successful receipt crosses off the assigned occurrence. Failed or uncertain work remains open.

Provider keys stay with your runtime. The app does not run a model or collect those keys. OpenClaw, Hermes, Grok and other agent products can implement the HTTP contract, but dedicated integrations are not included or verified.

Cancel an assignment or revoke a token to stop new work. This cannot undo an external action already in progress. A receipt records the agent's attestation, so review the evidence for consequential work.

## Connect a device

The optional iOS companion can preview selected lists, pair with your self-hosted instance and upload a reviewed snapshot. Completion writeback is a separate setting. Simulator mode is always synthetic; physical-device sync remains unverified. Follow [native sync](NATIVE-SYNC.md) before using real reminders.

The reviewed local section-import path is distinct: [original sections](native-sections.md) explains selected Mac recovery and the owner-attested phone result. Neither that import nor cloud saving enables native completion writeback or continuous two-way sync.

## Private cloud and another device

Use the app/profile that contains your imported copies: **More → Cloud Storage → Remember on This Device → Enable Cloud Storage**, then check **Saved to Cloud**. The current owner has attested completing this on the already-imported iPhone companion. Mac/browser profiles contain separate local data.

Keep the recovery code in a private place. On another device, connect using it, review the cloud preview and deliberately choose **Use Cloud Version** or **Keep This Device Version**. No code, private export or reminder contents belong in chat/Git. See the [cloud user guide](cloud-storage-user-guide.md) for conflict/history recovery; independent real cross-device restoration remains unverified.

## If saving fails

A server instance keeps an unsaved local draft when a session expires or a revision conflicts. Sign in again, export the draft if needed and explicitly reload/reconcile. Do not assume a failed response means a write did not commit.

## Known limits

Exact Apple screen pixels and dynamic Liquid Glass are unfinished. Notifications, geofences, full native field sync, real collaboration, offline conflict merging, comprehensive backup/restore and hosted model execution are not implemented. This is a personal preview application; evaluate with fictional data first.
