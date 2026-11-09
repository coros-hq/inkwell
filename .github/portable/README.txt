inkwell — portable edition
==========================

Run inkwell.exe. That's it — no installer, no admin rights.

Everything inkwell remembers is kept in the "data" folder that appears next to
inkwell.exe the first time you run it:

    data\Vault      your first vault (you can open any other folder as a vault too)
    data\webview    settings, themes, shortcuts, sign-in
    data\config     canvas, drawings and calendar data

Nothing is written to your Windows user profile (AppData, Documents, ...) — apart from
what you choose yourself, like a vault or a backup folder somewhere else.

Move it
-------
Close inkwell, then move or copy the whole folder (inkwell.exe + data) to another drive
or computer. Vaults kept inside the folder are found again automatically. A vault you
opened from somewhere else (for example D:\Notes) is remembered by its path, so open it
again from the new machine if that path doesn't exist there.

Update
------
Download the new portable zip, close inkwell, and replace inkwell.exe with the new one.
Keep the "data" folder. (Portable copies don't update themselves.)

Remove
------
Delete the folder. That's all.

Requirements
------------
Windows 10 or 11 with the Microsoft Edge WebView2 runtime (already included in Windows 11
and most Windows 10 installs).

If the folder is read-only (for example a locked USB stick), inkwell can't create "data"
and falls back to the normal Windows locations — use a writable folder to stay portable.
