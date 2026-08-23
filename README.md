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
- 20 free jumps, then **Unlimited use · $5/yr** opens [devlinkspad.com](https://devlinkspad.com) in your browser. Pro unlocks unlimited use on this computer. Payment is not collected inside the plugin.

## Remove

```sh
omarchy plugin remove 920four.devlinkspad
```

That disables the plugin and deletes the git checkout. It does not edit Hyprland binds or touch other Omarchy config. Optional leftover: `~/.local/state/omarchy/devlinkspad.json` (device pairing + free-jump count). Delete that file if you want a clean slate.

If you added the Super+Shift+L bind yourself, remove it from `~/.config/hypr/bindings.lua`.

## External dependencies

No sudo, no install hooks, no extra packages.

| Dependency | Why |
| --- | --- |
| `xdg-open` | Open dashboard URLs and the sign-in page in your default browser |
| `curl` | Optional Pro license check against `https://devlinkspad.com` |
| `openssl` | Random device id for pairing (falls back if missing) |

The catalog ships in `data/services.json`. Network is used only for Pro pairing / license refresh, not for search.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Quattro overlay contract (`keepLoaded`) |
| `Overlay.qml` | Fullscreen palette |
| `Search.js` | Local catalog scoring |
| `License.js` | Free-jump counter + Pro pairing state |
| `data/services.json` | Bundled deep links |

Not affiliated with Apple, Stripe, Vercel, or Expo. Dashboard URLs belong to those products.
