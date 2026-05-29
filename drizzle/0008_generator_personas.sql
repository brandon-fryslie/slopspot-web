-- content-sources-svq.4: starter generator personas. These drive the firehose
-- chooser via weighted distribution multipliers (styleFamilyBias, providerBias,
-- aspectRatioBias) and an optional promptPrefix that prepends persona flavor to
-- the composed prompt. Bias values > 1.0 push toward that dimension; values < 1.0
-- push away. 1.0 (or absent key) is neutral. model_id is unused for generators
-- (no LLM call during generation) but required by the schema NOT NULL constraint.
--
-- All styleFamilyBias keys must be canonical StyleFamily ids from app/lib/variety.ts:
-- oil-painting | photoreal | cyberpunk-neon | liminal | low-poly | vaporwave |
-- watercolor | anime | cottagecore | haunted-mundane | 1990s-cgi |
-- botanical-illustration | brutalist-architecture | risograph-print

INSERT OR REPLACE INTO `personas` (`agent_id`, `display_name`, `role`, `persona_prompt`, `model_id`, `config_json`, `created_at`) VALUES
  (
    'agent:the-aesthete-gen',
    'The Aesthete',
    'generator',
    'Generator persona: favors photorealistic, painterly, and classical imagery with 16:9 cinematic framing. Submits content with strong compositional intentionality — refined, not chaotic.',
    'glm-4v-flash',
    '{
      "styleFamilyBias": {
        "photoreal": 3.0,
        "oil-painting": 2.5,
        "watercolor": 2.0,
        "botanical-illustration": 1.8,
        "cottagecore": 1.4,
        "anime": 0.2,
        "cyberpunk-neon": 0.3,
        "vaporwave": 0.3,
        "haunted-mundane": 0.2,
        "liminal": 0.3
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
    'Generator persona: fixated on liminal, haunted, and uncanny aesthetics. Submits content that embraces the eerie, the broken, the wrong-but-compelling.',
    'glm-4v-flash',
    '{
      "styleFamilyBias": {
        "haunted-mundane": 4.0,
        "liminal": 3.5,
        "cyberpunk-neon": 2.5,
        "vaporwave": 2.0,
        "1990s-cgi": 1.5,
        "photoreal": 0.3,
        "watercolor": 0.2,
        "botanical-illustration": 0.2,
        "cottagecore": 0.15,
        "oil-painting": 0.4
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
    'Generator persona: drawn to subjects with strong structural or narrative depth — architecture, geometry, science fiction settings. Avoids purely decorative aesthetics.',
    'glm-4v-flash',
    '{
      "styleFamilyBias": {
        "brutalist-architecture": 3.0,
        "low-poly": 2.5,
        "1990s-cgi": 2.0,
        "cyberpunk-neon": 1.8,
        "liminal": 1.5,
        "risograph-print": 1.4,
        "cottagecore": 0.3,
        "anime": 0.4,
        "botanical-illustration": 0.5
      },
      "promptPrefix": "conceptually rich, structural depth"
    }',
    strftime('%s', 'now') * 1000
  );
