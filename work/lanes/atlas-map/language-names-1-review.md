# Language names 1 — founder review

**PROPOSED.** Reviewer and date are empty. Tobias: approve the table or mark exact changes; nothing here claims approval.

Survey: `obs-20261101T185031Z-db1a6987a0e6`; 487,655 observed channels, 57,289 mapped holdings. Land = holdings meeting the survey threshold, not population or territory.

All labels describe stream languages. The English UI keeps each channel’s own spelling. A name change never changes the land, IDs, coasts or coordinates. The table covers all 184 ISO two-letter codes plus `asl`, `other` and `zh-hk`; reserved codes do not assert Twitch support.

| Code | Map label | Land | Note |
|---|---|---:|---|
| en | English | 27,579 |  |
| ru | Streams in Russian | 7,537 | Language, not nationality; separate from uk. |
| de | German | 4,306 |  |
| es | Spanish | 3,435 |  |
| fr | French | 3,299 |  |
| pt | Portuguese | 2,795 |  |
| ja | Japanese | 2,527 |  |
| zh | Chinese | 1,504 | No country, script or Mandarin inference. |
| it | Italian | 786 |  |
| pl | Polish | 719 |  |
| ar | Arabic | 362 |  |
| uk | Streams in Ukrainian | 326 | Own isle; never folded into ru. |
| tr | Turkish | 285 |  |
| hu | Hungarian | 234 |  |
| nl | Dutch | 209 |  |
| fi | Finnish | 199 |  |
| th | Thai | 174 |  |
| cs | Czech | 159 |  |
| sv | Swedish | 140 |  |
| el | Greek | 131 |  |
| da | Danish | 125 |  |
| other | Other languages | 111 | Language unspecified by Twitch. |
| no | Norwegian | 74 |  |
| zh-hk | Cantonese | 71 | Cantonese, never a political region. |
| ko | Korean | 61 |  |
| ro | Romanian | 51 |  |
| bg | Bulgarian | 37 |  |
| sk | Slovak | 15 |  |
| tl | Tagalog | 13 | Tagalog follows the supplied code. |
| ca | Catalan | 9 |  |
| vi | Vietnamese | 6 |  |
| asl | American Sign Language | 4 | This sign language, not all sign languages. |
| hi | Hindi | 4 |  |
| id | Indonesian | 2 |  |
| ms | Malay | 0 | Observed; no mapped holding yet. |

Full table and review fields: [language-names-1.json](../../../apps/surveyor/src/cartography/language-names-1.json). The remaining ISO codes have zero observed holdings in this survey; their English names are in that same reviewable table.

Sources: [Twitch’s broadcaster-language field](https://dev.twitch.tv/docs/api/reference/#get-channel-information), [Twitch’s stream-language guide](https://help.twitch.tv/s/article/languages-on-twitch#streamlang), [Twitch’s ASL announcement](https://blog.twitch.tv/en/2016/07/15/say-hello-hallo-bonjour-ni-hao-hola-or-kon-nichiwa-to-multi-language-filters-twitch-blog-fa37fbbc4c07/), and [ISO language codes](https://www.loc.gov/standards/iso639-2/php/code_list.php). The guide did not render during this review; the ISO superset avoids relying on an incomplete menu list.

**Sign-off:** set `review.status` to `reviewed`, `reviewedBy` to the reviewer’s name and `reviewedAt` to the approval date only after Tobias’s actual approval. Keep the current proposal otherwise.
