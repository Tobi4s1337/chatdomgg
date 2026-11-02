# ElevenLabs ledger, teaser lane

The account's usage is read before and after each batch. The teaser's key has no permission to read the subscription endpoint, so usage comes from `GET /v1/usage/character-stats` (cumulative credits since 2026-10-01, the whole account); the client still tries the subscription endpoint first. That account total can lag and includes anything else spent on the account at the same time. "Used" is what this batch was billed: the sum of the `character-cost` response header over its fresh requests, falling back to after minus before when the header is missing. Cached requests cost nothing.

The lane's cap is 40,000 credits, summed over the Used column. Nothing secret is written here.

| When (UTC) | Purpose | Voice | Model | Requests (new/cached) | Characters sent | Account before | Account after | Used |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01 22:06 | Model comparison, one line | Rowan | eleven_multilingual_v2 | 1/0 | 53 | 11525 | 11525 | 23 |
| 2026-11-01 22:06 | Model comparison, one line | Rowan | eleven_v3 | 1/0 | 69 | 11525 | 11548 | 30 |
| 2026-11-01 22:08 | J01 voice comparison, five lines | David (VOG) | eleven_multilingual_v2 | 5/0 | 404 | 11578 | 11611 | 177 |
| 2026-11-01 22:08 | J01 voice comparison, five lines | David (Trailer) | eleven_multilingual_v2 | 5/0 | 404 | 11755 | 11833 | 422 |
| 2026-11-01 22:08 | J01 voice comparison, five lines | Rowan | eleven_multilingual_v2 | 5/0 | 404 | 12175 | 12249 | 177 |
| 2026-11-01 22:10 | Scratch narration for the rough cut | Rowan | eleven_multilingual_v2 | 17/0 | 443 | 12352 | 12497 | 196 |
| 2026-11-02 00:35 | Final narration, three takes per line | Rowan | eleven_multilingual_v2 | 36/15 | 940 | 12548 | 12905 | 417 |

## Notes

- 2026-11-01, TS10 voice work: 1,025 credits billed in total. That is 53 for the model comparison, 776 for J01 (the Trailer voice is billed about 2.4 times the standard rate) and 196 for the scratch narration. The account total read from usage stats moved from 11,525 to 12,548 (+1,023) over the same work. The lane has used 1,025 of 40,000.
- 2026-11-01 22:13: the hero sound effects were attempted and refused before any audio was made (the key lacks the `sound_generation` permission). Nothing was billed. needs: tobias enable sound effects on the teaser's ElevenLabs key.
- The teaser's key also lacks `user_read`, `models_read` and `speech_history_read`. That is why usage comes from usage stats and not the subscription endpoint.
