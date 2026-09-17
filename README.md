# Mineflayer-Kitbot

A Minecraft kit bot for teleport-enabled anarchy servers. Players type `!kit` in
chat, the bot walks to your dropper, picks up a kit, teleports the player to it,
and heads home for the next one. Optionally posts what it's doing to Discord.

## Requirements

* **Node.js 22 or newer** (required by mineflayer 4.39+)
* A Minecraft account with Microsoft authentication
* A server with `/tpa`-style teleport commands
* *(optional)* A Discord bot token, if you want notifications

## How it works

You build a dropper with a pressure plate that pushes one kit out when the bot
steps on it:

![Redstone setup](https://i.imgur.com/k2OJw4j.png)

Set the bot's respawn point (its bed) so that respawning leaves it facing the
plate. The delivery loop is then:

1. A player types `!kit` in chat.
2. The request joins a queue — one delivery at a time, in order.
3. The bot pathfinds to `kit.pickup` and waits a moment for the dropper.
4. It sends `/tpa <player>` and waits for them to accept.
5. On acceptance it announces the delivery and `/kill`s to respawn at home.

If any step times out the bot gives up on that player, tells them why, and moves
on to the next person in the queue.

## Installation

```bash
git clone https://github.com/TargetedEntropy/mineflayer-kitbot.git
cd mineflayer-kitbot
npm install
cp config.sample.json config.json
```

Then edit `config.json` and run it:

```bash
npm start
```

On first run with `auth: "microsoft"` the bot prints a device code and a URL —
sign in once and the token is cached for subsequent runs.

## Configuration

```jsonc
{
  "minecraft": {
    "host": "anarchy.example.com",  // server address
    "port": 25565,
    "username": "you@example.com",  // your Microsoft account email
    "auth": "microsoft",            // "microsoft", "offline" or "mojang"
    "version": false,               // false = negotiate with the server
    "profilesFolder": null          // where to cache auth tokens
  },
  "discord": {
    "token": "",                    // leave both empty to disable Discord
    "channelId": ""
  },
  "kit": {
    "pickup": { "x": 100, "z": -200 },  // the pressure plate
    "home":   { "x": 96,  "z": -200 },  // optional: where the bed is
    "trigger": "!kit",
    "cooldownMs": 60000,            // per-player, stops one person draining the dropper
    "pickupTimeoutMs": 60000,       // give up walking to the dropper
    "acceptTimeoutMs": 30000,       // how long a player has to accept the /tpa
    "returnTimeoutMs": 15000        // grace period for the trip home
  },
  "owners": ["your-minecraft-uuid"],
  "logLevel": "info"                // debug | info | warn | error | silent
}
```

`kit.home` is optional. When set, the bot warns if it respawns far from where
you said home is — a cheap way to notice a moved or broken bed.

### Environment variables

Anything below overrides `config.json`, which is handy for containers:

| Variable | Overrides |
| --- | --- |
| `KITBOT_MC_HOST` | `minecraft.host` |
| `KITBOT_MC_PORT` | `minecraft.port` |
| `KITBOT_MC_USERNAME` | `minecraft.username` |
| `KITBOT_MC_VERSION` | `minecraft.version` |
| `KITBOT_MC_AUTH` | `minecraft.auth` |
| `KITBOT_DISCORD_TOKEN` | `discord.token` |
| `KITBOT_DISCORD_CHANNEL_ID` | `discord.channelId` |
| `KITBOT_LOG_LEVEL` | `logLevel` |

### Upgrading from the old config format

The previous flat config (`server`, `email`, `kit_pos_x`, `whitelist_uuid`, …)
is still read and migrated automatically, with a warning telling you what moved.
Two things worth knowing:

* `kit_pos_y` actually held a **Z** coordinate; it becomes `kit.pickup.z`.
* `bed_pos_x` had no matching Z, so it could never really locate home. It is
  dropped — set `kit.home` to `{ x, z }` to re-enable the check.

## Commands

**Anyone, in public chat:**

| Command | Effect |
| --- | --- |
| `!kit` | Join the kit queue (configurable via `kit.trigger`) |

**Owners only, via `/msg <bot>`:** owners are matched on the UUID reported by
the server's player list, so impostor usernames don't help.

| Whisper | Effect |
| --- | --- |
| `queue` | Report who's being served and how many are waiting |
| `tpa` | Have the bot request a teleport to you |
| `kill` / `stop` | Shut the bot down (no reconnect) |

Owners also get their incoming `/tpa` requests auto-accepted.

## Operational notes

* **Reconnects** are handled with exponential backoff and jitter (5s up to 5
  minutes), and a clean connection resets the backoff. Each reconnect builds a
  completely fresh bot, so nothing leaks between sessions.
* **Discord is best-effort.** If the token is wrong or the channel is missing,
  the bot logs it once and keeps delivering kits. Messages sent before Discord
  finishes connecting are buffered, not lost.
* **Shutdown** on `SIGINT`/`SIGTERM` quits the Minecraft connection and closes
  Discord cleanly.

## Development

```bash
npm test     # lint + mocha
npm run lint
npm run fix
```

Layout:

| Path | Contents |
| --- | --- |
| `index.js` | Entry point: load config, start Discord, start the supervisor |
| `lib/config.js` | Loading, env overrides, validation, legacy migration |
| `lib/kitbot.js` | The bot itself plus the reconnect supervisor |
| `lib/kit-queue.js` | Delivery queue and per-player cooldowns |
| `lib/notifier.js` | Discord notifications |
| `lib/wait.js` | Timeout/abort-aware event helpers |
| `lib/logger.js` | Leveled logging |

## Credits

Built on [Mineflayer](https://github.com/PrismarineJS/mineflayer) and
[mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder).
