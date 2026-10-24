# Language expansion validation — 2026-10-04

## Release status

**Implemented locally, not deployed or activated.** The release target is 48 unique bidirectional languages for both participants, including free translated trials. Documentation is capability evidence; it does not establish audible quality, regional pronunciation, announcement accuracy, or reliable post-call extraction.

[Palabra's supported-language table](https://platform.palabra.ai/docs/speech-to-speech/supported-languages), checked October 4, lists both recognition and translation codes for these 48 languages. Recognition-only and translation-only rows are excluded. Regional variants are not counted separately. `scripts/translation-language-catalog.mjs` is the shared source of truth.

Default behavior preserves 13 common caller/recipient choices and the five existing recipient choices (Arabic, Dutch, Polish, Turkish, Ukrainian). Expansion makes both selectors identical. No production environment or provider setting was changed during implementation. “Existing” below describes inherited selectable behavior, not a fresh live-quality certification.

## Evidence and limits

- **Documented:** recognition and speech translation codes are listed by Palabra for all 48 languages. Chinese retains stored `zh`; expanded recognition uses `zh`, speech uses `zh-hans`. Traditional Chinese is not a second language choice. Default mode preserves the deployed `zh` speech alias.
- **Implemented:** mode-aware backend validation; identical expanded caller/recipient choices; trial support; worker mappings; shared labels and system-speech generation; all four prewarm clips; independent Call Record preferences; dynamic homepage, FAQ, translation page, Markdown and `/llms.txt`.
- **Tested offline:** all 2,256 directed different-language pairs, 48 same-language denials, unknown/automatic/one-way-only language rejection, legacy-provider restrictions, release flags, Chinese mapping, cloning disabled, and mocked announcement/go-ahead/failure/inactivity prompts. Trial tests exercise expanded pairs in both directions; both dialer variants expose the same 48 options and forward explicit selections.
- **Call Records:** all 48 output codes reach extraction context unchanged; multilingual transcript evidence survives prompt construction; saved names/codes remain readable after rollback. Existing transcription/review regression suites pass. Actual recognition, translated speech, extraction accuracy, and user review have **not** been tested live for the new languages. Mocked text assertions are not an end-to-end provider test.
- **Not executed:** paid API probes, clip prewarming, real calls, production deployment, or activation. Approval for those operations is still required by the delivery plan.

The current release switch activates the full catalog together. Do not enable it while any new language still fails acceptance. If staged activation becomes necessary, replace the full-catalog gate with an audited per-language release set before publishing a smaller expanded list.

## Per-language matrix

“Offline” means configuration, validation, announcement prompt and extraction-input checks only. Live acceptance is pending for every candidate in this change.

| Language | Stored code | Recognition → speech | Documented | Implemented | Offline | Live acceptance | Default selection |
|---|---|---|---|---|---|---|---|
| English | `en` | `en` → `en` | Yes | Yes | Pass | Pending | Existing, both |
| Spanish | `es` | `es` → `es` | Yes | Yes | Pass | Pending | Existing, both |
| Portuguese | `pt` | `pt` → `pt` | Yes | Yes | Pass | Pending | Existing, both |
| French | `fr` | `fr` → `fr` | Yes | Yes | Pass | Pending | Existing, both |
| German | `de` | `de` → `de` | Yes | Yes | Pass | Pending | Existing, both |
| Italian | `it` | `it` → `it` | Yes | Yes | Pass | Pending | Existing, both |
| Dutch | `nl` | `nl` → `nl` | Yes | Yes | Pass | Pending | Existing, recipient only |
| Polish | `pl` | `pl` → `pl` | Yes | Yes | Pass | Pending | Existing, recipient only |
| Ukrainian | `uk` | `uk` → `uk` | Yes | Yes | Pass | Pending | Existing, recipient only |
| Russian | `ru` | `ru` → `ru` | Yes | Yes | Pass | Pending | Existing, both |
| Arabic | `ar` | `ar` → `ar` | Yes | Yes | Pass | Pending | Existing, recipient only |
| Hindi | `hi` | `hi` → `hi` | Yes | Yes | Pass | Pending | Existing, both |
| Indonesian | `id` | `id` → `id` | Yes | Yes | Pass | Pending | Existing, both |
| Vietnamese | `vi` | `vi` → `vi` | Yes | Yes | Pass | Pending | Existing, both |
| Korean | `ko` | `ko` → `ko` | Yes | Yes | Pass | Pending | Existing, both |
| Japanese | `ja` | `ja` → `ja` | Yes | Yes | Pass | Pending | Existing, both |
| Chinese | `zh` | `zh` → `zh-hans` | Yes | Yes | Pass | Pending | Existing, both |
| Turkish | `tr` | `tr` → `tr` | Yes | Yes | Pass | Pending | Existing, recipient only |
| Armenian | `hy` | `hy` → `hy` | Yes | Yes | Pass | Pending | Disabled |
| Belarusian | `be` | `be` → `be` | Yes | Yes | Pass | Pending | Disabled |
| Bulgarian | `bg` | `bg` → `bg` | Yes | Yes | Pass | Pending | Disabled |
| Catalan | `ca` | `ca` → `ca` | Yes | Yes | Pass | Pending | Disabled |
| Croatian | `hr` | `hr` → `hr` | Yes | Yes | Pass | Pending | Disabled |
| Czech | `cs` | `cs` → `cs` | Yes | Yes | Pass | Pending | Disabled |
| Danish | `da` | `da` → `da` | Yes | Yes | Pass | Pending | Disabled |
| Estonian | `et` | `et` → `et` | Yes | Yes | Pass | Pending | Disabled |
| Filipino | `fil` | `fil` → `fil` | Yes | Yes | Pass | Pending | Disabled |
| Finnish | `fi` | `fi` → `fi` | Yes | Yes | Pass | Pending | Disabled |
| Galician | `gl` | `gl` → `gl` | Yes | Yes | Pass | Pending | Disabled |
| Greek | `el` | `el` → `el` | Yes | Yes | Pass | Pending | Disabled |
| Hebrew | `he` | `he` → `he` | Yes | Yes | Pass | Pending | Disabled |
| Hungarian | `hu` | `hu` → `hu` | Yes | Yes | Pass | Pending | Disabled |
| Kazakh | `kk` | `kk` → `kk` | Yes | Yes | Pass | Pending | Disabled |
| Latvian | `lv` | `lv` → `lv` | Yes | Yes | Pass | Pending | Disabled |
| Lithuanian | `lt` | `lt` → `lt` | Yes | Yes | Pass | Pending | Disabled |
| Macedonian | `mk` | `mk` → `mk` | Yes | Yes | Pass | Pending | Disabled |
| Malay | `ms` | `ms` → `ms` | Yes | Yes | Pass | Pending | Disabled |
| Norwegian | `no` | `no` → `no` | Yes | Yes | Pass | Pending | Disabled |
| Romanian | `ro` | `ro` → `ro` | Yes | Yes | Pass | Pending | Disabled |
| Serbian | `sr` | `sr` → `sr` | Yes | Yes | Pass | Pending | Disabled |
| Slovak | `sk` | `sk` → `sk` | Yes | Yes | Pass | Pending | Disabled |
| Slovenian | `sl` | `sl` → `sl` | Yes | Yes | Pass | Pending | Disabled |
| Swahili | `sw` | `sw` → `sw` | Yes | Yes | Pass | Pending | Disabled |
| Swedish | `sv` | `sv` → `sv` | Yes | Yes | Pass | Pending | Disabled |
| Tamil | `ta` | `ta` → `ta` | Yes | Yes | Pass | Pending | Disabled |
| Thai | `th` | `th` → `th` | Yes | Yes | Pass | Pending | Disabled |
| Urdu | `ur` | `ur` → `ur` | Yes | Yes | Pass | Pending | Disabled |
| Welsh | `cy` | `cy` → `cy` | Yes | Yes | Pass | Pending | Disabled |

## Reviewable change boundaries

1. **Landing rewrite:** landing components, translation-page copy, Markdown/template, and related copy guards. These can ship with the expansion flags off, using the catalog's existing common set. The shared language helper/catalog is the small dependency; worker/backend activation is not required. The headline contains no numeric language claim.
2. **Language expansion:** shared catalog, language/record helpers, dialer selectors, backend validation, worker and prewarm script, plus language/trial/lifecycle tests. Activation follows the coordinated runbook below.

No prices, included allowances, billing rules, database schema, MCP tools, or retained-audio policy changed. The old OpenAI path keeps its original recognition/output restrictions. Existing protected introduction and both-leg teardown remain intact.

See `REALTIME_WORKER_RUNBOOK.md` → “48-language release” for controlled acceptance and rollout. Keep the production trial flags at their existing values; they are independent of the new expansion flags.
