import { getPool } from "../src/db/client.js";
import { generateBiologyMappingSuggestions } from "../src/services/chapterMapping.service.js";

try {
  const result = await generateBiologyMappingSuggestions(2000);
  console.log(JSON.stringify(result));
} finally {
  await getPool()?.end();
}
