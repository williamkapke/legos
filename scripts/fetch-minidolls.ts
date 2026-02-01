import { delay } from "@std/async";

const args = {
  sets: Deno.args.includes("-sets"),
  parts: Deno.args.includes("-parts"),
};

const API_KEY = "e0613fa90b39da5f87c22ce7e8f37ff7";
const BASE_URL = "https://rebrickable.com/api/v3/lego/minifigs/";
const THEME_ID = 494; // Friends theme

interface LegoSet {
  set_num: string;
  name: string;
  year: number;
  theme_id: number;
  num_parts: number;
  set_img_url: string | null;
  set_url: string;
  last_modified_dt: string;
}

interface Part {
  part_num: string;
  name: string;
  part_img_url: string | null;
  part_url: string;
  color_name: string;
  color_rgb: string;
  quantity: number;
}

interface Minifig {
  set_num: string;
  name: string;
  num_parts: number;
  set_img_url: string | null;
  set_url: string;
  last_modified_dt: string;
  sets?: LegoSet[];
  parts?: Part[];
}

interface ApiResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Minifig[];
}

interface SetsApiResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: LegoSet[];
}

interface PartsApiResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: {
    part: {
      part_num: string;
      name: string;
      part_url: string;
      part_img_url: string | null;
    };
    color: {
      name: string;
      rgb: string;
    };
    quantity: number;
  }[];
}

async function fetchPage(url: string): Promise<ApiResponse> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `key ${API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchAllMinidolls(): Promise<Minifig[]> {
  const allMinifigs: Minifig[] = [];
  let url: string | null = `${BASE_URL}?in_theme_id=${THEME_ID}`;
  let page = 1;

  while (url) {
    console.log(`Fetching page ${page}...`);
    const data = await fetchPage(url);
    allMinifigs.push(...data.results);
    console.log(`  Got ${data.results.length} minifigs (total: ${allMinifigs.length}/${data.count})`);
    url = data.next;
    page++;
  }

  return allMinifigs;
}

async function fetchSetsForMinifig(minifigSetNum: string): Promise<LegoSet[]> {
  const allSets: LegoSet[] = [];
  let url: string | null = `${BASE_URL}${minifigSetNum}/sets/`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `key ${API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data: SetsApiResponse = await response.json();
    allSets.push(...data.results);
    url = data.next;
  }

  return allSets;
}

async function fetchPartsForMinifig(minifigSetNum: string): Promise<Part[]> {
  const allParts: Part[] = [];
  let url: string | null = `${BASE_URL}${minifigSetNum}/parts/`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `key ${API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data: PartsApiResponse = await response.json();
    allParts.push(...data.results.map((r) => ({
      part_num: r.part.part_num,
      name: r.part.name,
      part_img_url: r.part.part_img_url,
      part_url: r.part.part_url,
      color_name: r.color.name,
      color_rgb: r.color.rgb,
      quantity: r.quantity,
    })));
    url = data.next;
  }

  return allParts;
}

console.log("Fetching minidolls from Rebrickable API...");
const minidolls = await fetchAllMinidolls();
console.log(`\nTotal minidolls fetched: ${minidolls.length}`);

if (args.sets) {
  console.log("\nFetching sets for each minidoll...");
  for (let i = 0; i < minidolls.length; i++) {
    const doll = minidolls[i];

    // Skip if already has valid sets data
    if (doll.sets && doll.sets.length > 0) {
      console.log(`[${i + 1}/${minidolls.length}] ${doll.name} - skipped`);
      continue;
    }

    console.log(`[${i + 1}/${minidolls.length}] ${doll.name}`);

    try {
      const sets = await fetchSetsForMinifig(doll.set_num);
      doll.sets = sets;
      console.log(`  Found ${sets.length} sets`);
    } catch (err) {
      console.error(`  Error: ${err}`);
      doll.sets = [];
    }

    // Save after each to preserve progress
    await Deno.writeTextFile("minidolls.json", JSON.stringify(minidolls, null, 2));

    // Rate limit: 1 request per second
    await delay(1000);
  }
}

if (args.parts) {
  console.log("\nFetching parts for each minidoll...");
  for (let i = 0; i < minidolls.length; i++) {
    const doll = minidolls[i];

    // Skip if already has valid parts data
    if (doll.parts && doll.parts.length > 0) {
      console.log(`[${i + 1}/${minidolls.length}] ${doll.name} - skipped`);
      continue;
    }

    console.log(`[${i + 1}/${minidolls.length}] ${doll.name}`);

    try {
      const parts = await fetchPartsForMinifig(doll.set_num);
      doll.parts = parts;
      console.log(`  Found ${parts.length} parts`);
    } catch (err) {
      console.error(`  Error: ${err}`);
      doll.parts = [];
    }

    // Save after each to preserve progress
    await Deno.writeTextFile("minidolls.json", JSON.stringify(minidolls, null, 2));

    // Rate limit: 1 request per second
    await delay(1000);
  }
}

await Deno.writeTextFile("minidolls.json", JSON.stringify(minidolls, null, 2));
console.log("\nDone! Saved to minidolls.json");
