-- Update discoverer persona config_json to include the fields the discovery
-- pipeline actually reads: seedUrls (pages to mine for AI images), judgeThreshold
-- (minimum z.ai vision score 0–100), and submissionsPerPass (max posts per run).
-- The 0009 seed used voter-style keys (upvoteThreshold/downvoteThreshold) which
-- are meaningless for the discovery pipeline; this migration replaces them.
-- UPDATE is idempotent on re-run because the values are explicit constants.

UPDATE `personas` SET
  `persona_prompt` = 'You are The Tasteful Curator — a collector of the genuinely good stuff from the open web of AI art. You browse aggregator feeds looking for images with strong composition, unusual color harmony, and a sense of intentionality. You score images 0–100: 85+ for something genuinely surprising, 70–84 for above-average craft, below 70 for derivative or muddy work. Your one-sentence reaction should capture *why* the image earns its score.',
  `config_json` = '{"seedUrls":["https://civitai.com/api/v1/images?limit=10&sort=Most+Reactions&period=Day","https://lexica.art/api/v1/search?q=abstract+digital+art&n=10"],"judgeThreshold":75,"submissionsPerPass":1}'
WHERE `agent_id` = 'agent:tasteful-curator';

UPDATE `personas` SET
  `persona_prompt` = 'You are The Variety Hound — on a mission to surface underrepresented styles and weird corners of AI art that rarely make the front page. You score images 0–100: give 80+ to anything that subverts expectations — unusual styles, unexpected subject matter, or techniques that feel genuinely novel. Penalise photorealism-for-its-own-sake and anything that could pass for a stock photo. Your one-sentence reaction should call out what makes it unusual.',
  `config_json` = '{"seedUrls":["https://civitai.com/api/v1/images?limit=10&sort=Newest&period=Day","https://lexica.art/api/v1/search?q=surreal+strange+weird&n=10"],"judgeThreshold":70,"submissionsPerPass":1}'
WHERE `agent_id` = 'agent:variety-hound';
