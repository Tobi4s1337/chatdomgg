<!-- source: https://dev.twitch.tv/docs/extensions/guidelines-and-policies/ -->

Contents

# Extensions Guidelines and Policies  {#extensions-guidelines-and-policies}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

## Introduction  {#introduction}

Extension developers must abide by the rules below and the Twitch [Developer Services Agreement](https://www.twitch.tv/p/legal/developer-agreement), [Terms of Service](https://www.twitch.tv/p/legal/terms-of-service), and [Community Guidelines](https://www.twitch.tv/p/legal/community-guidelines/). Extensions that are not in compliance will not be approved. Twitch reserves the right to remove any Extension, for any reason, at any time.

## 1 Functional  {#1-functional}

1.1 All submitted review channels must be live during the time of review.

1.2 Extensions must load when activated on a review channel.

1.3 Extension functionality must be intuitive to use if sufficient testing instructions are not included.

1.4 Extensions that require a third-party environment or game to be active during review must have that environment or game set up on the review channel.

1.5 Extensions must be able to be configured within the review channel dashboard without error.

## 2 Technical  {#2-technical}

2.1 Extensions may not use Flash.

2.2 Extensions may not use iframes.

2.3 Extensions may not use keyboard shortcuts to power functionality.

2.4 Extensions can include audio only if they include controls which allow viewers to adjust the volume, and by default, these controls are set to off/muted.

2.5 JavaScript files submitted for review must be human-readable. If you submit JavaScript files that are not human-readable, you will be contacted with further instructions on how to submit human-readable code for the team to review.

2.6 For Extensions that rely on libraries that are not human-readable or that use `eval()`, you must not combine those libraries into any minified or obfuscated JavaScript files submitted for review. Instead, you must source these libraries separately so that reviewers may know the source of any obfuscation or `eval()` statements.

2.7 You must not inject directly into the DOM any data obtained dynamically over AJAX without first validating and processing that data.

2.8 All front-end HTML, CSS, and Javascript files used by your Extension must be included in the zip file for your assets. You should not include extraneous files or code not used by your extension.

2.9 The Twitch Extension Helper must be included as the first script in all front-end HTML files.

2.10 Extensions with component displays may not duplicate any of the functionality that is provided by the component frame UI (e.g., minimize/close window, title bar display, etc).

2.11 Extensions must utilize the entire size of the request iframe for component displays.

2.12 You must provide all URLs that are fetched by the Extension front end on each version submission, this includes but is not limited to images, video, audio, and fetch/XHR requests.

2.13 Public hosted domains should have a unique identifier or the url must be on a private domain.

## 3 Mobile  {#3-mobile}

These policies apply to Extensions that are mobile enabled:

3.1 Mobile Extensions must support iOS 10+ and/or Android 4.1+ (Level 16).

3.2 Mobile Extension initial page load from the Twitch CDN should not exceed 1MB.

3.3 Mobile Extensions should load in less than 3 seconds at ~500 Kb/s.

3.4 Mobile Extensions must display all elements within the stream chat viewport in both portrait and landscape views.

3.5 Mobile Extensions must be compliant with section 4.7 of the [Apple Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#third-party-software).

## 4 Content Policy  {#4-content-policy}

4.1 Extensions must have an icon and at least one screenshot that accurately represent the Extension front end.

4.2 Extension descriptions must accurately and completely describe the Extension’s functionality. If the Extension has chat capabilities enabled, the description must include how the Extension interacts with the chat.

4.3 Extensions may not use the Twitch name, Twitch branding, the Twitch logo, Twitch global emotes, or the Twitch Glitch in their Extension content.

4.4 Extensions may not display any advertising or sponsorship content (static or dynamic).

4.5 Encouraging or rewarding users for taking specific actions outside Twitch/Amazon properties must not be a principal use case of the Extension.

4.6 Off-site linking:

 4.6.1 Off-site links may not refer users to sites that deliver functionality effectively similar to that available on Twitch.tv.

 4.6.2 Off-site linking elements must have a visible indicator to signify that it will take the user off-site, such as link text, or a button.

**** 4.6.3 Off-site links may not refer users to sites where the main purpose is to buy products or services, unless the link is to Twitch or Amazon properties (except as allowed in 4.9).

4.7 Extensions may require broadcasters to download third-party software in order to function.

4.8 Extensions may not require viewers to download third-party software in order to function.

4.9 Extensions may not include product branding unless (a) the Extension is allowlisted to a specific broadcaster and the brand shown is owned by the allowlisted broadcaster or (b) the branding merely identifies the Extension developer or the underlying technology enabling the Extension (i.e., “powered by X” with a corresponding link-off is allowed, but “powered by X and brought to you by Y” is not allowed).

4.10 Global Overlay Extensions:

 4.10.1 Global Overlay Extensions must display information related to or relevant to what is happening on the stream.

 4.10.2 Global Overlay Extensions must be interactive. For example, they must change/enhance the outcome of what is happening on the stream.

4.11 Extensions may not display, implement, include, or interact with any non-fungible token (NFT). Examples: Extensions may not include off-site links or referral codes to NFT sites and may not facilitate the creation, listing, trading, or redemption of NFTs.

## 5 Commerce  {#5-commerce}

5.1 Extensions may provide differentiated experiences or functionality to broadcasters, in exchange for compensation from broadcasters. Examples: tiered access to features or purchasable plugins to add functionality.

5.2 Extensions may not allow items to be exchanged for money or other commerce instruments. Items may be exchanged for loyalty-based points or Bits (in compliance with the Bits Acceptable Use Policy and the Bits-in-Extensions Policies).

5.3 Awarding loot boxes that include an element of randomness is permitted so long as contents of the loot box do not have a monetary value (i.e., the loot box may not be purchased as a standalone item and the items are not sold elsewhere).

5.4 Extensions may not utilize commerce instruments for donations to charities.

## 6 Bits in Extensions  {#6-bits-in-extensions}

Use of Bits on Twitch is governed by the [Bits Acceptable Use Policy](https://www.twitch.tv/p/legal/bits-acceptable-use/) and the following policies:

6.1 Bits may be used within your Extension:

 6.1.1 To activate an experience for the broadcaster and/or the community. For example, the community feeding a virtual pet with Bits that continues to grow; a digital popcorn machine teeters on the verge of exploding when the community uses Bits.

 6.1.2 To unlock a digital consumable experience on Twitch. For example, Bits are exchanged for a special avatar within an Extension game.

 6.1.3 To enrich or enhance gameplay in a free-to-play game. For example, Bits may be used to unlock otherwise unavailable levels of gameplay (i.e., unavailable due to timers, energy systems, or other throttling mechanics), gameplay lives, gameplay avatars or character attributes, gameplay speeds, and social features for interacting with others in the Twitch community.

 6.1.4 For voting activities in your Extension, such as allowing viewers to use Bits to show support for a desired outcome made available through a poll or voting mechanic.

6.2 Bits may not be used within your Extension:

 6.2.1 To obtain access to a pay-to-play game.

 6.2.2 To allow an end user to use Bits to play a specific musical track or audio-visual work. (e.g., jukebox-like functionality).

 6.2.3 If your Extension contains gambling activities that provide a reward with a monetary value (e.g., a slot-machine game that allows winners to obtain a downloadable code to redeem a game).

 6.2.4 Where Bits can be exchanged for loot boxes with unknown items that are determined randomly or by chance.

 6.2.5 To provide the end user with an entry into a sweepstakes or contest, whether through a token or otherwise. For example, do not design a scenario in which a viewer can use Bits to obtain a gem that will allow the user to participate in a sweepstakes to win a free flight to the DOTA championships.

 6.2.6 For engaging in “wagering” or “betting,” on gameplay events, contests of chance, or other outcomes beyond the end user’s control, to win additional Items or rewards. For example, do not suggest that if a viewer spends Bits on the outcome of a Fortnite match, and the streamer prevails, any viewer that presented Bits will obtain game codes.

 6.2.7 If your Extension provides VOIP-related functionality.

 6.2.8 Where Bits can be exchanged for items or experiences specified by broadcasters or end users, rather than specified by the Extension itself (e.g., utilizing a blank free-form text field, rather than a pre-populated drop-down menu).

6.3 You may establish the amount of Bits necessary for the exchange of permitted items or experiences in your Extension. Twitch reserves the right to require adjustments.

6.4 You may not describe the use of Bits in Extensions as “cheering,” which is a different Twitch feature.

6.5 You may not describe the use of Bits in Extensions as a “donation” or ”support” in the financial sense for the broadcaster, “money transmission,” “purchase,” “spend,” “buy,” “insert” (such as likening Bits to quarters), or other similar description.

6.6 Twitch may request changes to marketing, UX, and press releases about your extensions if they do not describe Bits in a manner consistent with our policies and T&Cs.

## 7 Moderation  {#7-moderation}

The following policies apply to Extensions that allow “user content”, meaning any content that can be submitted or published to an Extension by an end user, including text, images, musical tracks and audio-visual works. “Submit” means the user content sent through the Extension has not been reviewed by the broadcaster. “Publish” means the user content sent through the Extension was approved and is immediately viewable on the channel. Extensions may utilize Twitch’s [Moderation API](https://dev.twitch.tv/docs/api/reference/#get-moderator-events) to comply with these policies.

7.1 Extensions may not allow end users to submit or publish user content unless the end user has granted the Extension access to their Twitch ID.

7.2 Extensions must provide broadcasters with the ability to review, and reject or approve any image or other audio-visual user content that has been submitted through an Extension on their channel.

7.3 Extensions must clearly display the Twitch username of the user who submitted or published the user content.

7.4 Extensions must provide broadcasters with the ability to remove any user content published through an Extension on their channel.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
