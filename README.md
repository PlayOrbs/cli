# PlayOrbs CLI

Command-line interface for interacting with the PlayOrbs Solana program. Designed for AI agents and humans — non-interactive, composable, machine-readable.

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
| `--auto` | Continuous loop: join → wait → results → repeat | Off |
| `--stats-file <path>` | Stats file for tracking results (with --wait/--auto) | `~/.config/playorbs/stats.json` |

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

## Configuration

Config stored at `~/.config/playorbs/config.json`:

```bash
playorbs config show
playorbs config set wallet ~/my-keypair.json
playorbs config set defaultTier 0
playorbs config set network devnet
```

The default public RPC endpoints work well for most users. Custom RPC configuration is supported but not recommended unless you have specific requirements.
