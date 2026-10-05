# Active Ragdolls for Sandboxels

A mod for [Sandboxels](https://sandboxels.r74n.com/) that adds self-balancing, walking, fighting stick-figure ragdolls.

> **Status: work in progress.** Things still change a lot between versions.

## What it adds

- A **Ragdolls** menu: Human, Player, Fighter, Zombie and Big ragdolls, plus Red / Blue / Green team versions of each.
- **Active ragdolls**: they balance on their legs, walk, jump, stumble, get knocked down and get back up.
- **Per-limb health** (head, torso, both arms, both legs). Broken legs make them limp or crawl.
- **Fall and crash damage that depends on impact speed**, only hurting the limbs that hit.
- **Dismemberment**: limbs can come off as separate pieces.
- **Teams**: different team colours fight each other. Zombies infect people.
- **Many ways to die**: burning, drowning, choking on gas, suffocation, freezing, poison, radiation, starvation, electric shock, acid, explosions and more.
- They can **eat** food (crouch, gather it into a ball, lift it to the head).
- A **Drag tool integration**: pick ragdolls up and throw them.
- A **Revive** tool and an in-game **settings menu** (button in the bottom-left corner).

## Controls (Player Ragdoll)

| Key | Action |
| --- | --- |
| Left / Right | Walk (or swim) |
| Up | Jump / swim up |
| Down | Punch (dive when swimming) |
| E | Eat nearby food |
| Tab | Switch to the next player ragdoll |
| Hold G + click-drag | Grab a ragdoll with any element selected |

## Install

### Option 1: load it from this repository (recommended)

1. Open Sandboxels in your browser.
2. Open the browser console (press **F12**, then the **Console** tab).
3. Paste this one line and press Enter (replace `YOURNAME` and `YOURREPO`):

```js
var s=document.createElement("script");s.src="https://cdn.jsdelivr.net/gh/YOURNAME/YOURREPO@main/active_ragdoll.js";document.head.appendChild(s);
```

If your Sandboxels version has a **Mod Manager** (Settings), you can instead add this URL there so the mod loads every time:

```
https://cdn.jsdelivr.net/gh/YOURNAME/YOURREPO@main/active_ragdoll.js
```

### Option 2: paste the whole file

Open `active_ragdoll.js`, copy everything, paste it into the browser console and press Enter.
You need to do this again after every page reload.

> If you load a new version, reload the page first so the old copy isn't still running.

## Settings

Click the **Ragdolls** button in the bottom-left corner of the page. Settings are saved in your browser.

## Known issues

- Written for the browser version of Sandboxels; the exact element names used for interactions (acid, electricity, food...) can differ between versions.
- Swimming and floating are still being tuned.

## License

MIT, see `LICENSE`.
