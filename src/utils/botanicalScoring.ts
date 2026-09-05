import {
  PlantSpecies,
  SpaceProfile,
  SpaceZone,
  UserPlantPreferences,
  PlantStyleCategory,
  RecommendationResult,
  PlantRecommendationScore,
} from '../types';
import { plantCatalog } from '../data/plantCatalog';

export interface BotanicalScorecard {
  overallScore: number;
  spaceScore: number;
  lightScore: number;
  climateScore: number;
  maintenanceScore: number;
  preferenceScore: number;
  rationale: string;
}

/**
 * Checks whether a species matches the given category
 */
export function matchesPlantCategory(species: PlantSpecies, category?: PlantStyleCategory): boolean {
  if (!category || category === 'all') return true;
  if (category === 'air_purifying') {
    // NASA clean-air & natural indoor gas/VOC filtering species
    const airPurifyingIds = ['snake-plant', 'spider-plant', 'peace-lily', 'pothos-golden', 'boston-fern'];
    return (
      airPurifyingIds.includes(species.id) ||
      airPurifyingIds.includes(species.plantId || '') ||
      (species as any).airPurifying === true ||
      species.description.toLowerCase().includes('clean air') ||
      species.description.toLowerCase().includes('resilient') ||
      species.environmentalInformation?.co2AbsorptionTime === 'night_crassulacean'
    );
  }
  if (category === 'medicinal') {
    // Therapeutic herbal wellness, healing gel, soothing teas & digestives
    const medicinalIds = ['aloe-vera', 'peppermint', 'sweet-basil'];
    return (
      medicinalIds.includes(species.id) ||
      medicinalIds.includes(species.plantId || '') ||
      (species as any).medicinal === true ||
      species.description.toLowerCase().includes('healing') ||
      species.description.toLowerCase().includes('soothing') ||
      species.description.toLowerCase().includes('medicinal')
    );
  }
  if (category === 'flowering') return species.plantCategory === 'flowering';
  if (category === 'herbs_edible') return species.plantCategory === 'herb_edible';
  if (category === 'succulent_cactus') return species.plantCategory === 'succulent_cactus';
  if (category === 'decorative' || category === 'indoor_greenery') {
    return (
      species.plantCategory === 'indoor_foliage' ||
      species.plantCategory === 'climbing_vine' ||
      species.plantCategory === 'fern'
    );
  }
  if (category === 'pet_friendly') return !!species.petSafe;
  if (category === 'low_maintenance') return species.maintenanceLevel === 'low' || species.waterFrequencyDays >= 7;
  return true;
}

/**
 * Filter catalog by category
 */
export function getCategoryFilteredSpecies(
  catalog: PlantSpecies[] = plantCatalog,
  category?: PlantStyleCategory
): PlantSpecies[] {
  const filtered = catalog.filter((s) => matchesPlantCategory(s, category));
  if (filtered.length > 0) return filtered;
  // Fallback if category is empty
  return catalog;
}

/**
 * 5-Factor Botanical Analysis Engine
 * Evaluates:
 * 1. Space Fit
 * 2. Light Match
 * 3. Climate & Temp
 * 4. Care Schedule / Maintenance
 * 5. User Preferences & Pet Safety
 */
export function calculateBotanicalScorecard(
  species: PlantSpecies,
  zone?: SpaceZone,
  space?: SpaceProfile,
  preferences?: UserPlantPreferences
): BotanicalScorecard {
  const targetLight = zone?.lightLevel || 'medium_indirect';
  const baseline = (space as any)?.environmentalBaseline;
  const indoorTemp = baseline?.indoorTemp?.value || 22;
  const indoorHumidity = baseline?.indoorHumidity?.value || 48;
  const chosenStyle = preferences?.plantStyle || 'all';
  const petInHousehold = preferences?.petInHousehold ?? false;
  const maintenancePref = preferences?.maintenancePreference || 'low';
  const locationType = preferences?.desiredLocationType || 'shelf_table';

  // 1. SPACE FIT (0 - 100)
  let spaceScore = 88;
  if (locationType === 'window_sill' || locationType === 'shelf_table') {
    if (species.sizeCategory === 'small') spaceScore = 98;
    else if (species.sizeCategory === 'medium') spaceScore = 82;
    else spaceScore = 65; // large plant crowded on a sill
  } else if (locationType === 'floor_stand' || locationType === 'floor') {
    if (species.sizeCategory === 'large' || species.sizeCategory === 'medium') spaceScore = 96;
    else spaceScore = 86;
  } else if (locationType === 'hanging' || locationType === 'vertical_hanging') {
    if (species.plantCategory === 'climbing_vine' || species.id === 'spider-plant' || species.id === 'boston-fern') {
      spaceScore = 98;
    } else if (species.sizeCategory === 'small') {
      spaceScore = 88;
    } else {
      spaceScore = 70;
    }
  } else if (locationType === 'balcony_railing') {
    if (species.plantCategory === 'herb_edible' || species.plantCategory === 'succulent_cactus') {
      spaceScore = 97;
    } else {
      spaceScore = 85;
    }
  }

  // 2. LIGHT MATCH (0 - 100)
  let lightScore = 85;
  const req = species.lightRequirement;
  if (targetLight === 'direct_sun') {
    if (req === 'direct_sun') lightScore = 98;
    else if (req === 'bright_indirect') lightScore = 84;
    else lightScore = 62; // foliage scorching risk
  } else if (targetLight === 'bright_indirect') {
    if (req === 'bright_indirect') lightScore = 98;
    else if (req === 'direct_sun') lightScore = 84; // good, but prefers windowsill
    else lightScore = 90;
  } else if (targetLight === 'medium_indirect') {
    if (req === 'medium_indirect') lightScore = 98;
    else if (req === 'low_light') lightScore = 94;
    else if (req === 'bright_indirect') lightScore = 86;
    else lightScore = 68;
  } else {
    // low light
    if (req === 'low_light' || species.minimumLight === 'low_light') lightScore = 96;
    else if (req === 'medium_indirect') lightScore = 82;
    else lightScore = 54; // sun-loving herb/flower in low light
  }

  // 3. CLIMATE & TEMP (0 - 100)
  let climateScore = 90;
  const idealHum = species.idealHumidityPct || 50;
  const humDiff = Math.abs(indoorHumidity - idealHum);
  if (humDiff <= 8) climateScore = 97;
  else if (humDiff <= 15) climateScore = 90;
  else if (humDiff <= 25) climateScore = 80;
  else climateScore = 72;

  // Temp check (normal indoor is 18 - 25 C)
  if (indoorTemp >= 18 && indoorTemp <= 26) {
    climateScore = Math.min(99, climateScore + 2);
  }

  // 4. CARE SCHEDULE / MAINTENANCE (0 - 100)
  let maintenanceScore = 88;
  if (maintenancePref === 'very_low' || maintenancePref === 'low') {
    if (species.maintenanceLevel === 'low' || species.waterFrequencyDays >= 10) maintenanceScore = 98;
    else if (species.waterFrequencyDays >= 5) maintenanceScore = 89;
    else maintenanceScore = 72; // thirsty plant needing daily care
  } else if (maintenancePref === 'moderate') {
    if (species.waterFrequencyDays >= 3 && species.waterFrequencyDays <= 7) maintenanceScore = 96;
    else maintenanceScore = 90;
  } else {
    // high
    maintenanceScore = 95;
  }

  // 5. PREFERENCES & SAFETY (0 - 100)
  let preferenceScore = 85;
  const isCategoryMatch = matchesPlantCategory(species, chosenStyle);
  if (isCategoryMatch) {
    preferenceScore = chosenStyle === 'all' ? 92 : 98;
  } else {
    preferenceScore = 58;
  }

  // Pet Safety check
  if (petInHousehold) {
    if (species.petSafe) {
      preferenceScore = Math.min(100, preferenceScore + 2);
    } else {
      preferenceScore = Math.max(45, preferenceScore - 35);
    }
  }

  // Overall Weighted Score
  const overallScore = Math.round(
    spaceScore * 0.2 +
      lightScore * 0.25 +
      climateScore * 0.2 +
      maintenanceScore * 0.15 +
      preferenceScore * 0.2
  );

  // Dynamic Botanical Rationale tailored to species & conditions
  let rationale = '';
  if (species.plantCategory === 'herb_edible') {
    rationale = `${species.commonName} aligns with your Veggies & Herbs preference, pairing vigorous culinary foliage with your ${targetLight.replace('_', ' ')} exposure.`;
  } else if (species.plantCategory === 'flowering') {
    rationale = `${species.commonName} provides recurring indoor blooms calibrated to your ambient room lighting and ${species.petSafe ? 'pet-safe' : 'decorative'} preferences.`;
  } else if (species.plantCategory === 'succulent_cactus') {
    rationale = `${species.commonName} excels in drought tolerance and CAM night respiration, matching low-water maintenance schedules.`;
  } else {
    rationale = `${species.commonName} delivers lush air-transpiring foliage harmonized with your ${space?.name || 'living space'} microclimate.`;
  }

  if (petInHousehold && !species.petSafe) {
    rationale += ' (Note: Keep out of direct reach of curious pets).';
  }

  return {
    overallScore,
    spaceScore,
    lightScore,
    climateScore,
    maintenanceScore,
    preferenceScore,
    rationale,
  };
}

/**
 * Converts BotanicalScorecard into PlantRecommendationScore
 */
export function scorecardToBreakdown(scorecard: BotanicalScorecard): PlantRecommendationScore {
  return {
    spaceCompatibility: scorecard.spaceScore,
    lightCompatibility: scorecard.lightScore,
    climateCompatibility: scorecard.climateScore,
    maintenanceCompatibility: scorecard.maintenanceScore,
    preferenceScore: scorecard.preferenceScore,
    overallSuitability: scorecard.overallScore,
    label: 'LittleStep suitability score',
  };
}

/**
 * Generates an end-to-end deterministic recommendation for a given space and category
 */
export function generateBotanicalRecommendation(
  catalog: PlantSpecies[] = plantCatalog,
  space?: SpaceProfile,
  zone?: SpaceZone,
  preferences?: UserPlantPreferences
): RecommendationResult {
  const targetZone = zone || space?.zones?.[0] || {
    id: 'zone-1',
    name: 'Primary Plant Zone',
    zoneType: 'plant_zone',
    lightLevel: 'bright_indirect',
    color: '#10b981',
    x: 10,
    y: 10,
    w: 30,
    h: 30,
    recommendedSize: 'medium',
  };

  const chosenCategory = preferences?.plantStyle || 'all';
  const filteredSpecies = getCategoryFilteredSpecies(catalog, chosenCategory);

  // Score all candidates
  const scored = filteredSpecies.map((species) => {
    const scorecard = calculateBotanicalScorecard(species, targetZone, space, preferences);
    return {
      species,
      scorecard,
      score: scorecard.overallScore,
    };
  });

  // Sort descending by overall match rate
  scored.sort((a, b) => b.score - a.score);

  const primary = scored[0] || {
    species: catalog[0],
    scorecard: calculateBotanicalScorecard(catalog[0], targetZone, space, preferences),
    score: 90,
  };

  const alternatives = scored.slice(1, 3).map((item) => ({
    species: item.species,
    reason: `${item.species.commonName} is a complementary choice for ${targetZone.name} with ${item.species.lightRequirement.replace('_', ' ')} lighting.`,
    score: item.score,
    highlightDifference: item.species.description.slice(0, 75) + '...',
    scorecard: item.scorecard,
  }));

  const categoryName =
    chosenCategory === 'air_purifying'
      ? 'Air Purifying Plants'
      : chosenCategory === 'medicinal'
      ? 'Medicinal Plants'
      : chosenCategory === 'herbs_edible'
      ? 'Veggies & Herbs'
      : chosenCategory === 'flowering'
      ? 'Plants with Flowers'
      : chosenCategory === 'succulent_cactus'
      ? 'Succulents & Cacti'
      : chosenCategory === 'decorative'
      ? 'Decorative Live Foliage'
      : 'All Plant Companions';

  return {
    canAdoptMore: true,
    recommendationId: `rec-${chosenCategory}-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    statusRationale: `Space has capacity for 1 new companion in ${categoryName}.`,
    spaceUtilizationPct: 20,
    primaryRecommendation: {
      species: primary.species,
      targetZoneId: targetZone.id,
      targetZoneName: targetZone.name,
      matchReasons: [
        `Optimal physiological fit for your ${categoryName} preference`,
        `Calibrated to ${targetZone.name}'s ${targetZone.lightLevel.replace('_', ' ')} exposure`,
        `Thrives in ${space?.name || 'your space'} at ~${(space as any)?.environmentalBaseline?.indoorHumidity?.value || 48}% humidity`,
        preferences?.petInHousehold && primary.species.petSafe
          ? '🐾 100% Pet-safe companion for homes with dogs & cats'
          : `Water rhythm: Every ${primary.species.waterFrequencyDays} days`,
      ],
      placementTip: `Place in ${targetZone.name} with suitable drainage and indirect airflow.`,
      suitabilityScore: primary.score,
      scoreBreakdown: scorecardToBreakdown(primary.scorecard),
      scorecard: primary.scorecard,
    },
    alternatives,
    sustainabilityWarning: '🌱 Start with this single companion. Maintain it well for 7+ days to build sustainable green habits.',
  };
}
