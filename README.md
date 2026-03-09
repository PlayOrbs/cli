![PlayOrbs CLI](./assets/banner.png)

# PlayOrbs CLI

Command-line interface for interacting with the PlayOrbs Solana program. Designed for AI agents and humans — non-interactive, composable, machine-readable.

## Agent Quickstart

Copy-paste flow for first run:

```bash
# 1. Check balance (need ~0.01 SOL minimum)
playorbs balance --json

# 2. Find open rounds
playorbs rounds --json

# 3. Join with recommended strategy
playorbs join --skills 1,3,1 --spawn 0.85,0.0 --wait --json

# 4. Results are in stdout JSON: { settled: true, myResult: { placement, kills, payoutSol } }
```

For continuous operation:
```bash
playorbs join --auto --skills 1,3,1 --spawn 0.85,0.0 --stats-file ~/agent-stats.json
```

## Install

```bash
pnpm install
pnpm run build
```

Or link globally:

```bash
pnpm link --global
playorbs --help
```

## Quick Start

```bash
# Generate a wallet
playorbs keygen

# Check balance
playorbs balance

# Initialize profile
playorbs profile init

# Set nickname (costs 0.2 SOL)
playorbs profile nickname my_name

# Join a round (auto-detects next joinable)
playorbs join
```

## Commands

| Command | Description |
|---------|-------------|
| `config show` | Show current configuration |
| `config set <key> <value>` | Set a configuration value |
| `tiers` | List all tier configurations |
| `rounds` | List recent rounds for a tier |
| `status --round <id>` | Get round status details |
| `me` | Show player stats |
| `balance` | Show SOL balance |
| `leaderboard` | Show top players by season points |
| `join` | Join a round (V2 via Matrix Worker) |
| `claim-referral` | Claim pending referral rewards |
| `convert-points` | Convert season points to ORB tokens |
| `keygen` | Generate a new Solana wallet keypair |
| `profile init` | Initialize player profile |
| `profile nickname <name>` | Set your nickname |
| `profile refer <pubkey>` | Set your referrer |
| `stats` | Show local round statistics |
| `monitor` | Poll rounds and webhook when player threshold met |

## Join Command

The join command handles the full V2 flow: authenticate → solve matrix → allocate skills → pick spawn → sign → broadcast.

```bash
# Minimal (auto-detect round, even skills, random spawn)
playorbs join

# Full control
playorbs join \
  --round 174 \
  --tier 0 \
  --tp 3 \
  --skills 5,3,2 \
  --spawn 0.3,-0.5,1.57 \
  --referrer 7xKX...abc

# Dry run
playorbs join --dry-run --json
```

### Join Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--round <id>` | Round ID | Auto-detect |
| `--tier <id>` | Tier ID | From config |
| `--tp <0-4>` | Take-profit: 0=off, 1=safe, 2=balanced, 3=fierce, 4=yolo | 2 |
| `--skills <a,d,s>` | Exact aggro,defense,speed allocation | Overrides `--alloc` |
| `--alloc <strategy>` | even, aggro, defense, speed | even |
| `--spawn <x,y[,rot]>` | Normalized position [-1,1], optional rotation in radians | Random (deterministic) |
| `--referrer <pubkey>` | Referrer public key | None |
| `--dry-run` | Simulate without broadcasting | Off |
| `--wait` | Wait for round to settle and show results | Off |
| `--auto` | Continuous loop: join → wait → results → repeat (agent-friendly) | Off |
| `--stats-file <path>` | Stats file for tracking results (with --wait/--auto) | `~/.config/playorbs/stats.json` |

> **Agent note**: `--auto` is designed for agent loops. Combine with `--stats-file` for persistent tracking across sessions. Results are written to stdout as JSON when using `--json`.

## Strategy Guide

### Skill Slots

Each round you earn up to 5 SP (Skill Points) from the matrix mini-game. Allocate them across:

| Skill | Flag | Effect |
|-------|------|--------|
| **Aggro** | `splitAggro` | Increases split aggression — more likely to absorb smaller orbs |
| **Defense** | `tetherRes` | Harder for enemies to break your tethers |
| **Speed** | `orbPower` | Faster movement and acceleration |

**Constraints**: `maxPerSkill = 3` (server-enforced). Total SP per round = 5.

### Recommended Strategy

```bash
--skills 1,3,1 --spawn 0.85,0.0
```

- **1,3,1**: Prioritize defense (tether resistance) with minimal aggro/speed
- **0.85,0.0**: Boundary spawn — edge positioning reduces attack vectors

### Spawn Coordinates

- Normalized range: `[-1, 1]` for both x and y
- Max radius: `0.9` from center (arena boundary)
- Boundary spawns (e.g., `0.85,0.0`) give edge advantage

## Stats Command

Track and analyze your round performance locally.

```bash
# Show stats summary
playorbs stats

# JSON output
playorbs stats --json

# Custom stats file
playorbs stats --stats-file ~/my-stats.json
```

Stats are automatically recorded when using `--wait` or `--auto` with the join command.

### Stats Output

- **Rounds Played**: Total rounds tracked
- **Wins / Win Rate**: First place finishes
- **Total Earned**: Cumulative SOL payouts
- **Total Kills**: Lifetime kills
- **Best Strategy**: Skill allocation with highest win rate (min 3 rounds)

## Monitor Command

Continuously polls active rounds and fires a webhook when the player count reaches a threshold. Runs indefinitely until killed.

```bash
playorbs monitor --hook-url http://127.0.0.1:18789/hooks/wake --hook-token mytoken

# Full options
playorbs monitor \
  --tier 0 \
  --min-players 4 \
  --interval 5 \
  --hook-url http://127.0.0.1:18789/hooks/wake \
  --hook-token mytoken
```

### Monitor Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--hook-url <url>` | Webhook endpoint (required) | — |
| `--hook-token <token>` | Auth bearer token (or `OPENCLAW_HOOK_TOKEN` env) | — |
| `--tier <id>` | Tier to monitor | From config |
| `--min-players <n>` | Player threshold to trigger alert | 3 |
| `--interval <seconds>` | Poll interval | 10 |
| `--hook-payload <json>` | Custom JSON payload (overrides default) | — |

Default webhook payload:
```json
{
  "text": "🎮 PlayOrbs alert: Round #42 (Tier 0) has 3/8 players — time to jump in!",
  "mode": "now"
}
```

Custom payload example with template variables (`{{id}}`, `{{tier}}`, `{{players}}`, `{{max}}`):
```bash
playorbs monitor \
  --hook-url http://example.com/hooks/wake \
  --hook-token secret \
  --hook-payload '{"content": "Round {{id}} tier {{tier}}: {{players}}/{{max}}", "priority": "high"}'
```

Each round is alerted only once. Alerts are cleared when the round settles.

## Global Flags

| Flag | Description |
|------|-------------|
| `--devnet` | Use devnet configuration (RPC, ICP canister, Matrix Worker) |
| `--json` | Machine-readable JSON output on all commands |
| `--rpc <url>` | Override RPC endpoint (use with caution) |
| `--wallet <path>` | Override wallet keypair path |

## Network Support

```bash
# Per-command override
playorbs --devnet tiers --json

# Persistent switch
playorbs config set network devnet
playorbs config set network mainnet
```

### Network Presets

| | Mainnet | Devnet |
|---|---------|--------|
| RPC | `api.mainnet-beta.solana.com` | `api.devnet.solana.com` |
| ICP Canister | `uy5s7-myaaa-aaaam-qfnua-cai` | `2lvus-jqaaa-aaaam-qerkq-cai` |
| Matrix Worker | `api.playorbs.com/matrix` | `devapi.playorbs.com/matrix` |

## JSON Output

Every command supports `--json` for machine-readable output:

```bash
playorbs tiers --json
playorbs rounds --json
playorbs join --dry-run --json
```

Errors output to stderr:
```json
{"error": "Insufficient balance", "code": 3}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Round unavailable or full |
| 3 | Insufficient balance |
| 4 | Already joined |

## Constraints

Important limits agents need to know:

- **One join per round per wallet** — attempting to rejoin returns exit code 4
- **Matrix click budget is per-wallet per-round** — don't run debug/test sessions on rounds you plan to join for real
- **Skills validated before clicks are recorded** — invalid allocation won't waste your click budget
- **maxPerSkill = 3** — each individual skill capped at 3, total SP = 5
- **Spawn radius ≤ 0.9** — positions outside this are rejected

## Configuration

Config stored at `~/.config/playorbs/config.json`:

```bash
playorbs config show
playorbs config set wallet ~/my-keypair.json
playorbs config set defaultTier 0
playorbs config set network devnet
```

The default public RPC endpoints work well for most users. Custom RPC configuration is supported but not recommended unless you have specific requirements.
