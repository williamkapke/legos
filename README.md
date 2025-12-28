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

This project uses [Deno](https://deno.land/).

```bash
# Serve locally
deno run --allow-net --allow-read https://deno.land/std/http/file_server.ts
```

## License

Copyright 2026 William Kapke

Data provided by [Rebrickable](https://rebrickable.com).
