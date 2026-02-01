#!/usr/bin/env node

const minidolls = JSON.parse(await Deno.readTextFile('./minidolls.bricklink.json'));

// Identify torso, legs, and hair parts from a minidoll's parts array
function getCoreSignature(parts) {
  let torso = null;
  let legs = null;
  let hair = null;
  let hatOrHelmet = null;

  for (const part of parts) {
    const desc = part.description.toLowerCase();
    if (desc.includes('torso')) {
      torso = `${part.partNum}:${part.colorId}`;
    }
    if (desc.includes('legs') || desc.includes('hips')) {
      legs = `${part.partNum}:${part.colorId}`;
    }
    // Prioritize hair over hat/helmet, but skip hair accessories/decorations
    if (desc.includes('hair') && !desc.includes('hair decoration') && !desc.includes('hair accessories')) {
      hair = `${part.partNum}:${part.colorId}`;
    } else if (desc.includes('helmet') || desc.includes('hat')) {
      hatOrHelmet = `${part.partNum}:${part.colorId}`;
    }
  }

  // Use hair if found, otherwise fall back to hat/helmet
  const headwear = hair || hatOrHelmet;

  // Only return signature if torso and legs are present (headwear is optional)
  if (torso && legs) {
    return `${torso}|${legs}|${headwear || 'none'}`;
  }
  return null;
}

// Get set of part identifiers for a minidoll
function getPartSet(parts) {
  return new Set(parts.map(p => `${p.partNum}:${p.colorId}`));
}

// Group minidolls by core signature
const groups = new Map();

for (const doll of minidolls) {
  if (!doll.parts || doll.parts.length === 0) continue;

  const signature = getCoreSignature(doll.parts);
  if (!signature) continue;

  if (!groups.has(signature)) {
    groups.set(signature, []);
  }
  groups.get(signature).push(doll);
}

// Build variations output
const variations = {};

for (const [_signature, dolls] of groups) {
  // Only process groups with more than 1 minidoll
  if (dolls.length < 2) continue;

  // Sort by part count, then by ID number for ties
  dolls.sort((a, b) => {
    const countDiff = a.parts.length - b.parts.length;
    if (countDiff !== 0) return countDiff;

    // Extract numeric portion of ID for comparison
    const numA = parseInt(a.id.replace(/\D/g, ''), 10);
    const numB = parseInt(b.id.replace(/\D/g, ''), 10);
    return numA - numB;
  });

  const primary = dolls[0];
  const primaryParts = getPartSet(primary.parts);
  const primaryVariations = {};

  for (let i = 1; i < dolls.length; i++) {
    const variant = dolls[i];
    const variantParts = getPartSet(variant.parts);

    // Find parts in variant that are not in primary
    const differingParts = [];
    for (const partKey of variantParts) {
      if (!primaryParts.has(partKey)) {
        differingParts.push(partKey.split(':')[0]); // Just the part number
      }
    }

    if (differingParts.length > 0) {
      primaryVariations[variant.id] = differingParts;
    }
  }

  if (Object.keys(primaryVariations).length > 0) {
    variations[primary.id] = primaryVariations;
  }
}

await Deno.writeTextFile('./minidolls.bricklink.variations.json', JSON.stringify(variations, null, 2));
console.log(`Generated variations for ${Object.keys(variations).length} primary minidolls`);
