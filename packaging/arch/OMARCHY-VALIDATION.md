# Omarchy release-candidate validation

Complete this checklist on a real x86-64 Omarchy installation before describing
the corresponding Skillglass release as verified on Omarchy. Test the exact
`.pkg.tar.zst` proposed for publication; rebuilding after the test invalidates
the result.

## Record the environment

- Skillglass version, release tag, commit, package filename, and SHA-256
- Omarchy version and update date
- Hardware or VM model, display scale, and monitor layout
- Hyprland and Wayland versions

## Install and launch

1. Compare the package SHA-256 with `SHA256SUMS.txt`.
2. Install with `sudo pacman -U ./skillglass-vVERSION-linux-x64.pkg.tar.zst`.
3. Run `pacman -Qk skillglass` and require zero missing files.
4. Launch Skillglass once from the Omarchy application menu and once with
   `skillglass` in a terminal. Both launches must succeed without disabling the
   Electron sandbox.
5. Confirm the application icon, title, native window controls, fonts, focus,
   keyboard navigation, dialogs, scrolling, display scaling, and reduced-motion
   behavior are usable under Hyprland/Wayland.

## Exercise the product contract

1. Complete onboarding against a disposable folder containing representative
   `SKILL.md` fixtures.
2. Scan and inspect without observing any filesystem write outside Skillglass
   application data.
3. Preview an install or edit and verify the plan and exact diff before applying
   it to an approved user-writable fixture root.
4. Restart Skillglass, confirm the operation journal persists, and undo the
   unchanged test operation.
5. Confirm no administrator prompt appears inside Skillglass and no telemetry or
   network request is required for the workflow.

## Record the result

Attach terminal output, screenshots of the main views, and any relevant logs to
the release review. Record pass or fail for every item. Any crash, visual blocker,
sandbox workaround, missing package file, or contract violation blocks the
Omarchy support claim for that artifact.
