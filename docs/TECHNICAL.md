# NextFloor Alarm Shield

A soft, translucent protective dome around your home while an alarm panel is armed. Works with Alarmo and other Home Assistant `alarm_control_panel` entities. Independent NextFloor plugin, no fork and no modifications to NextFloor's bundles.

## Behaviour

| Alarm state | Shield |
|---|---|
| Disarmed / disarming | Hidden |
| Armed home, away, night, vacation, custom bypass | Subtle glow, optional slow pulse |
| Arming / pending | Amber, gently pulsing |
| Triggered | Stronger red pulse, no strobe |
| Unknown / unavailable / missing | Hidden; never presented as armed |

Display only: the plugin never arms, disarms or triggers an alarm. It sends no alarm service calls. Preview buttons simulate the **visual** state for 30 seconds and label the view **VORSCHAU**. Preview state is never written to Home Assistant or saved as an alarm state.

## Install locally

1. Copy `nextfloor-alarmo-shield.js` to `/config/www/nextfloor/alarm-shield/nextfloor-alarmo-shield-1.0.1.js`.
2. NextFloor → Extensions → Plugins: add `/local/nextfloor/alarm-shield/nextfloor-alarmo-shield-1.0.1.js`.
3. Place your alarm entity in the editor and enable **Alarm-Schutzschild → Schutzschild aktiv** in its device settings. Saving at least one of this plugin's settings on that placement explicitly selects this alarm; unconfigured alarms are never guessed.
4. Reload the page. Native plugin settings persist with the plan.

To expose the settings/preview dialog in the central star menu, add an own button with action `fire_dom_event` and data:

```json
{"nextfloor_shield":{"action":"settings"}}
```

The button may be labelled **Schutzschild**, with icon `shield-home-outline`. In plans that use this plugin alongside the Cameras plugin, tapping an alarm marker may open Home Assistant's alarm dialog through Cameras. The star-menu button reliably opens this plugin's settings and preview instead.

Settings: enabled, glow intensity (0–45%), house padding, armed colour (red/cyan/violet), soft pulse, optional energy grid, include detached outbuildings, show only in whole-house view. The dialog can save these fields in the plan; it fetches the latest building and checks for conflicting changes to the alarm's settings. Do not edit the plan simultaneously in another tab while saving plugin settings.

The primary house is detected from the largest connected cluster of rooms across floors. Detached garages are excluded unless requested. Basement height and the roof are included. No house coordinates or entity names are hard-coded.

## Hosting on GitHub

This is one self-contained ES module, also suitable for HTTPS hosting. NextFloor accepts an HTTPS URL ending in `.js` (with an optional query). Prefer a URL pinned to a commit and a SHA-256 in the plan's plugin reference. For reliable offline use, keep a local copy on Home Assistant even if you publish the source on GitHub. Do not publish your private floor plan, entity inventory, photographs or screenshots with the plugin.

## Compatibility and limitations

- Tested with NextFloor **0.24.0**, plugin API **1**.
- Native plugin API supplies device settings, status markers and room sections. It does **not** yet expose an arbitrary 3D effect layer.
- The dome therefore uses a small, isolated, feature-checked adapter to the existing `nf-view3d` camera. A transparent Canvas overlay projects the shell with the same view and projection matrices, so it follows rotation, pan and zoom. It does not replace the renderer or monkey-patch NextFloor.
- The shell is a display overlay, not a depth-tested Three.js mesh. It can tint the house and nearby objects where the projected dome overlaps them. The primary house must be in its normal stacked arrangement; an exploded view is not a single physical volume.
- Breaking internal changes can require updating this adapter. If its camera fields are unavailable, the overlay stays off and the settings dialog reports the incompatibility. This is **not** a guarantee of compatibility with every future NextFloor update.
- A separate canvas keeps taps on rooms and devices usable (`pointer-events: none`). It does not affect the plan geometry, furniture visibility or energy readings.
- Respects `prefers-reduced-motion`; pulses stop when reduced motion is requested. Rendering stops while hidden/disarmed or the page is in the background. No CDN dependencies, tracking, tokens, or external network requests.
- Disabling/removing the plugin takes effect after reloading the page, as with other NextFloor plugins.

## Development

Requires Node.js 20+; no dependencies or build step.

```sh
npm test
npm run check
```

Tests cover alarm-state mapping, reduced motion, settings validation, connected house bounds, basement/roof coverage, projection, finite mesh geometry, smooth silhouette, adapter failure and absence of alarm-control/network operations. Real-alarm transitions are deliberately not used for testing.

MIT licensed. Independent community plugin; not an official NextFloor or Alarmo component.
