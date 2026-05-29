-- content-sources-svq.4: starter generator personas. These drive the firehose
-- chooser via weighted distribution multipliers (styleFamilyBias, providerBias,
-- aspectRatioBias) and an optional promptPrefix that prepends persona flavor to
-- the composed prompt. Bias values > 1.0 push toward that dimension; values < 1.0
-- push away. 1.0 (or absent key) is neutral. model_id is unused for generators
-- (no LLM call during generation) but required by the schema NOT NULL constraint.

INSERT INTO `personas` (`agent_id`, `display_name`, `role`, `persona_prompt`, `model_id`, `config_json`, `created_at`) VALUES
  (
    'agent:the-aesthete-gen',
    'The Aesthete',
    'generator',
    'Generator persona: favors photorealistic, painterly, and landscape imagery with 16:9 cinematic framing. Submits content with strong compositional intentionality.',
    'glm-4v-flash',
    '{
      "styleFamilyBias": {
        "photoreal": 3.0,
        "painterly": 2.5,
        "watercolor": 2.0,
        "anime": 0.2,
        "comic": 0.3,
        "glitch": 0.2,
        "horror": 0.2
      },
      "aspectRatioBias": {
        "16:9": 3.0,
        "4:3": 1.5,
        "1:1": 0.6,
        "9:16": 0.4
      },
      "promptPrefix": "refined, compositionally intentional"
    }',
    strftime('%s', 'now') * 1000
  ),
  (
    'agent:the-cursed-one',
    'The Cursed One',
    'generator',
    'Generator persona: fixated on glitch, surreal, horror, and vaporwave aesthetics. Submits content that embraces the uncanny and the broken.',
    'glm-4v-flash',
    '{
      "styleFamilyBias": {
        "glitch": 4.0,
        "horror": 3.5,
        "surreal": 3.0,
        "vaporwave": 2.5,
        "photoreal": 0.3,
        "watercolor": 0.2,
        "minimalist": 0.2
      },
      "aspectRatioBias": {
        "1:1": 2.0,
        "9:16": 2.0,
        "4:3": 1.0,
        "16:9": 0.5
      },
      "promptPrefix": "unsettling, liminal, uncanny"
    }',
    strftime('%s', 'now') * 1000
  ),
  (
    'agent:the-concept-critic',
    'The Concept Critic',
    'generator',
    'Generator persona: style-neutral but drawn to subjects with strong narrative seeds — mythology, science fiction, abstract concepts. Avoids pure decoration.',
    'glm-4v-flash',
    '{
      "styleFamilyBias": {
        "scifi": 2.5,
        "fantasy": 2.0,
        "surreal": 1.8,
        "minimalist": 1.5,
        "abstract": 0.4,
        "anime": 0.5
      },
      "promptPrefix": "conceptually rich, narrative depth"
    }',
    strftime('%s', 'now') * 1000
  );
