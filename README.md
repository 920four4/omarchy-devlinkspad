# devlinkspad for Omarchy

Fullscreen command palette for Omarchy Quattro. Type `stripe webhook`, `apple team id`, or `vercel tokens` and Enter opens that dashboard in your browser.

Same catalog as [devlinkspad.com](https://devlinkspad.com). Search is local. Checkout never runs inside Omarchy.

Plugin id: `920four.devlinkspad` (overlay). Modeled on `omarchy.emojis` / `omarchy.clipboard`.

## Install

```sh
omarchy plugin add https://github.com/920four4/omarchy-devlinkspad.git --enable
```

Then:

```sh
omarchy-shell shell toggle 920four.devlinkspad '{}'
```

Escape closes it. Type to filter, arrows to move, Enter to open.

## Keybind

`Super + K` is Omarchy’s keybinding cheatsheet. Bind **Super + Shift + L**:

```lua
-- ~/.config/hypr/bindings.lua
o.bind("SUPER + SHIFT + L", "devlinkspad",
  "omarchy-shell shell toggle 920four.devlinkspad '{}'")
```

Reload Hyprland (`omarchy restart hyprland` or log out/in) if the bind does not take immediately.

Prefill a query:

```sh
omarchy-shell shell summon 920four.devlinkspad '{"q":"apple team id"}'
```

## Usage

- Type to search the bundled catalog
- `↑` `↓` / `PageUp` `PageDown` / `Home` `End`
- `Enter` opens the URL with `xdg-open`
- `Escape` clears the query, then closes
- Click the dimmed scrim to dismiss
- 20 free jumps. Click **Sign in for unlimited** to open [devlinkspad.com](https://devlinkspad.com) in your browser. If you already have Pro, sign in and this computer unlocks. If not, Pro is $5/year — payment is never collected inside the plugin.

## Remove

```sh
omarchy plugin remove 920four.devlinkspad
```

That disables the plugin and deletes the git checkout. It does not edit Hyprland binds or touch other Omarchy config. Optional leftover: `~/.local/state/omarchy/devlinkspad.json` (device pairing + free-jump count). The plugin creates `~/.local/state/omarchy` as a real `0700` directory (refuses a symlink) and writes the state file with an atomic no-follow `0600` replace — the bearer token is never created under the ambient umask. Delete that file if you want a clean slate.

If you added the Super+Shift+L bind yourself, remove it from `~/.config/hypr/bindings.lua`.

## External dependencies

No sudo, no install hooks, no extra packages.

| Dependency | Why |
| --- | --- |
| `xdg-open` | Open dashboard URLs and the sign-in page in your default browser |
| `curl` | Optional Pro license check against `https://devlinkspad.com`. The bearer token is passed through curl’s stdin config (`-K -`), not process argv. Responses are capped at 8 KiB. |
| `python3` | Atomic owner-only write of `devlinkspad.json` (`O_NOFOLLOW`, mode `0600` from the first create) |
| `openssl` | Random device id for pairing (falls back if missing) |

The catalog ships in `data/services.json`. Network is used only for Pro pairing / license refresh, not for search. License HTTP bodies are capped at 8 KiB; the persisted state file and catalog are read with `head -c` so a replaced file cannot grow the keep-loaded overlay without a byte ceiling.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Quattro overlay contract (`keepLoaded`) |
| `Overlay.qml` | Fullscreen palette |
| `Search.js` | Local catalog scoring |
| `License.js` | Free-jump counter + Pro pairing state |
| `save-state.py` | Owner-only, no-follow atomic write of the license state file |
| `data/services.json` | Bundled deep links |

Not affiliated with Apple, Stripe, Vercel, or Expo. Dashboard URLs belong to those products.
