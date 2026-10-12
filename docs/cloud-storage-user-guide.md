# Private Cloudflare storage

Cloud Storage saves your personal reminders, lists, sections, templates, and safe account import mappings in a private encrypted backup on Cloudflare. Each backup has its own random recovery code. It does not use a shared app password or the public demo’s workspace.

## Save this device

1. Open **More → Cloud Storage** in the Reminders sidebar or iPhone Home toolbar.
2. On your own device, optionally select **Remember on This Device**. This stores the recovery code in this browser or companion app’s local storage so saving can resume after reopening. Leave it off on shared devices.
3. Choose **Enable Cloud Storage**. This is the action that encrypts and uploads this device’s current reminders.
4. Choose **Copy Code** or **Show Code** and save the recovery code privately, such as in your password manager. The app never copies it automatically.

Anyone with this code can read and change that backup. Cloudflare does not receive the decryption key, and the app cannot recover a lost code. Without **Remember on This Device**, the cloud connection lasts until the page closes. Keep the code before clearing app storage or closing the page.

The sidebar and sheet show the save status. Changes save automatically after a short delay while this device is connected. A network error leaves your local changes in place and shows that they are not saved to cloud storage. Open the sheet to retry or check the cloud copy.

If setup is interrupted, an encrypted backup may already exist. Keep the displayed recovery code and retry **Enable Cloud Storage**; the retry checks the same workspace. With **Remember on This Device** selected, the pending code is saved before upload so reopening can resume it. Without it, save the code privately before closing the page. Reopening alone does not upload anything.

## Use another device

1. Open the same Reminders deployment and choose **More → Cloud Storage**.
2. Enter your recovery code in **Connect an Existing Backup**. Optionally select **Remember on This Device** before connecting.
3. Choose **Preview Cloud Reminders**. The preview does not replace or upload this device’s reminders.
4. Review its list names and counts, including sections. **Export This Device Backup** first if you want to keep a separate local copy.
5. Choose **Use Cloud Version** to replace this device’s saved reminders with the cloud copy, or **Keep This Device Version** to replace the cloud copy with this device’s reminders.

The same choices are used if another device saved a newer version. A conflict stops automatic cloud writes so one device cannot silently overwrite the other. Use **Check Cloud for Changes**, review the preview, and choose deliberately. Previous encrypted backups can also be previewed before restoring.

**Disconnect This Device** removes its cloud connection while keeping its local reminders and the encrypted cloud backup. No Apple or Google reminders are deleted by disconnecting or choosing a cloud version.

## Account connections and privacy

Cloud storage includes safe import provenance and selected-list metadata so future imports can match existing local copies. Google access tokens, Google passwords, Apple credentials, and cloud recovery codes are excluded from backup snapshots. Google must be connected again on another device before refreshing lists or allowing Google Tasks completion.

Apple import remains a local, permissioned copy operation. If you turn on Cloud Storage afterward, that local copy is included in your private encrypted backup. Cloud saving does not write changes back to iCloud. Imported iCloud sections are preserved when they are present in the source snapshot; the native import guide explains current Apple API limits.

Browser storage and any recovery code you choose to remember are accessible to someone who can use that browser profile. Use your device’s lock and store the code privately. Do not paste recovery codes into URLs, support tickets, GitHub issues, or chat.

## Limits

The current backup limit is 1,000 lists, 10,000 reminders, and approximately 1.25 MB of decrypted snapshot data. Oversized or invalid data stays on the device and is reported instead of uploaded. Photo attachment binaries and external agents’ credentials are not included in this snapshot backup. Keep separate copies of original photos.

The feature requires the deployment’s private Cloudflare endpoint. Server-workspace mode uses its existing storage path and does not show these browser-local cloud controls. Enabling Cloud Storage is always explicit; opening the app or sheet alone does not upload personal reminders.
