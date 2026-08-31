# askedthrice

Command-line tool for [Asked Thrice](https://askedthrice.com): find out whether AI assistants actually name a brand when buyers ask them for a recommendation.

Free, no account, no API key. Nothing to configure and no credential to store.

```sh
npx askedthrice check "Asked Thrice" --category "AI visibility tools"
```

## Why a CLI

The measurement is worth running more than once. Model answers move between identical runs, so a single result is a coin flip and a repeated one is evidence. A command is the shortest path to running it again next month, or on every brand in a list, or inside a script that reports what changed.

## Commands

### `check`: does one model know the brand?

```sh
askedthrice check "Acme" --category "project management"
```

Asks one model two things: whether it recognises the brand, and whether it names the brand in a list for the category. The list comes from a prompt that never mentions the brand, which is the whole test. A model will agree that a brand is good when you name it, and that agreement means nothing.

```
Acme — project management

  verdict        barely visible
  knows it       yes
  describes it   Acme is a project management tool for small teams.

  Asked for the category without naming the brand, gemini-3.1-flash-lite answered:
     1. Asana
     2. Monday.com
     3. Acme   <- this brand
     4. Linear
```

### `repeat`: how much does the answer move?

```sh
askedthrice repeat "best CRM for a small team" --provider openai
```

Asks the same question five times, at temperature zero, and reports which brands came back every time and which came back once. The ones that appear once are the point: identical inputs, different answers.

### `audit`: the full snapshot

```sh
askedthrice audit "Acme" --website acme.com --category "project management"
```

Crawls the site, classifies what the business does, then asks several providers and repeats each prompt. Takes 15 to 60 seconds because the questions are asked live. Prints an audit id.

Add `--language es` and `--location Argentina` to measure a Spanish-speaking market.

### `map`: the buyer questions, asked live

```sh
askedthrice map <audit-id> --start
```

Takes the buyer questions the audit generated and asks each one to each provider, then shows which ones named the brand. Without `--start` it reads the stored map instead of measuring again.

## For scripts and agents

`--json` prints the raw API response:

```sh
askedthrice check "Acme" --category CRM --json | jq '.recommendations'
```

Errors go to stderr and the exit code is 1. Every failure carries a stable `code` and a `hint` saying what to do:

```
Too many audit requests. Try again later.
  Wait for the number of seconds in Retry-After. The limits are 6 per hour and 40 per day per caller.
  Wait about 2 minutes before trying again.
```

## Limits

Every measurement spends real money at the model providers, so the free tier is metered per caller: `check` 6 per hour and 20 per day, `repeat` 3 per hour, `audit` 6 per hour and 40 per day. There is no paid tier and no key to request. Treat 429 and 503 as ordinary states.

## Other ways in

- **MCP server**: if your assistant speaks MCP, it can run a measurement itself: `https://mcp.askedthrice.com/mcp`, or the [`askedthrice-mcp`](https://www.npmjs.com/package/askedthrice-mcp) bridge for clients that only launch local commands.
- **HTTP API**: the same endpoints this CLI wraps, described in OpenAPI 3.1 at [askedthrice.com/openapi.json](https://askedthrice.com/openapi.json).
- **The website**: [askedthrice.com](https://askedthrice.com) runs the free snapshot in a browser.

## Options

| Flag | What it does |
|---|---|
| `--json` | Print the raw API response. |
| `--timeout <ms>` | Give up after this long. Default 90000. |
| `--base <url>` | Point at another deployment. |
| `--version`, `-v` | Print the version. |
| `--help`, `-h` | Print usage. |

## Links

- Docs for developers and agents: [askedthrice.com/developers](https://askedthrice.com/developers)
- How the measurement works: [askedthrice.com/methodology](https://askedthrice.com/methodology)
- Contact: [askedthrice.com/contact](https://askedthrice.com/contact)

MIT licensed. Built by [Nahuel Soria](https://askedthrice.com/about) in Buenos Aires.
