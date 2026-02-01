# LEGO Collection Tools

Personal tools for browsing and exploring LEGO Friends sets and minidolls.

## Pages

- **index.html** - Landing page with links to collections
- **bigbuy.html** - Browser for my "Big Buy" of Friends sets with image galleries
- **minidolls.html** - Explorer for LEGO Friends minidolls and their parts

## Data Files

- `sets.json` - Set data for the Big Buy collection
- `minidolls.json` - Minidoll character data with parts info
- `part-images.json` - Part image URLs including photos
- `images/` - Downloaded set images organized by set number

## Development

This project uses [Deno](https://deno.land/) and [Kapture MCP](https://kapture.dev) for browser automation.

```bash
# Start the backend API server (port 8787)
deno task dev
```

## Scripts

All scripts are in the `scripts/` directory and run with Deno. Most require [Kapture MCP](https://kapture.dev) for browser automation.

### `server.ts`

Backend API server for updating minidoll metadata (ownership, notes, set associations).

```bash
deno task dev
# or
deno run --allow-net --allow-read --allow-write scripts/server.ts
```

Listens on port 8787 with the following endpoints:
- `POST /minidolls/owned` - Mark a minidoll as owned (`{id, owned}`)
- `POST /minidolls/note` - Add/update a note on a minidoll (`{id, note}`)
- `POST /minidolls/setId` - Link a minidoll to a set (`{id, setId}`)

### `fetch-bricklink.ts`

Scrapes the BrickLink catalog for LEGO Friends minidoll data (IDs, images, descriptions, and parts lists). Merges results into existing data, preserving manual edits.

```bash
deno run -A scripts/fetch-bricklink.ts
```

Outputs to `minidolls.bricklink.json`.

### `fetch-minidolls.ts`

Fetches minidoll data from the Rebrickable API for the Friends theme.

```bash
deno run -A scripts/fetch-minidolls.ts [-sets] [-parts]
```

- `-sets` - Also fetch all sets each minidoll appears in
- `-parts` - Also fetch all parts that make up each minidoll

Outputs to `minidolls.json`. Rate-limited to 1 request/second.

### `fetch-minidoll-images.ts`

Downloads images for minidolls and/or their parts via browser scraping.

```bash
deno run -A scripts/fetch-minidoll-images.ts [-minidolls] [-parts]
```

- `-minidolls` - Fetch images for minidoll characters
- `-parts` - Fetch images for individual parts

At least one flag is required. Images are saved to `images/{type}/{id}/`.

### `fetch-images.ts`

Downloads set images from Rebrickable pages.

```bash
deno run -A scripts/fetch-images.ts
```

Reads set data from `sets.json`, downloads images to `images/{setNum}/`, and updates `sets.json` with image URLs.

### `fetch-set-parts.ts`

Scrapes a specific set's inventory from BrickLink.

```bash
deno run -A scripts/fetch-set-parts.ts <set_id>
```

- `<set_id>` - BrickLink set ID (e.g., `41335-1`)

Extracts part numbers, colors, descriptions, and thumbnails. Merges into `set-inventory.json`.

### `fetch-colors.ts`

Scrapes the BrickLink color reference table. Requires a Kapture tab already open to the BrickLink color page.

```bash
deno run -A scripts/fetch-colors.ts
```

Outputs to `bricklink-colors.json`.

### `fetch-ca-store-terms.ts`

Fetches store terms/policies from BrickLink seller shops listed in `data/ca-stores.json`.

```bash
deno run -A scripts/fetch-ca-store-terms.ts
```

Reads store names from `data/ca-stores.json` and saves each store's terms back to the same file.

### `generate-variations.js`

Analyzes minidolls and groups them by character variations based on shared torso, legs, and hair/headwear parts.

```bash
deno run scripts/generate-variations.js
```

Reads `minidolls.bricklink.json` and outputs variation mappings to `minidolls.bricklink.variations.json`.

## License

Copyright 2026 William Kapke

Data provided by [Rebrickable](https://rebrickable.com).
