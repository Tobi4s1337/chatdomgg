<!-- source: https://dev.twitch.tv/docs/extensions/submission-best-practices/ -->

Contents

# Submission Best Practices  {#submission-best-practices}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

With a large variety of Extensions being submitted, adoption of an Extension can be difficult for broadcasters due to the differing setups of each Extension. This document outlines best practices for submitting your Extensions for review.

## Quicker reviews and faster adoption  {#quicker-reviews-and-faster-adoption}

When creating an Extension, keep in mind the flow broadcasters will follow the first time they use it. Following is a list of ways that you can simplify your configuration to increase adoption and speed up the review time of your Extension:

- Complete a quality assurance pass on your Extension. The more you do to ensure that the setup and usage of your Extension is a smooth experience, the quicker the reviewer can get through the review and help you release your Extension.

- Make sure the configuration page can be saved successfully and the Extension can be activated.
- Once activated check that the Extension loads when activated on a channel.
- Complete some functionality flows and make sure they don’t cause the user to become stuck at a certain page, or crash the Extension.
- Consider asking a friend or colleague that is unfamiliar with the Extension to run through the experience to see if they understand the purpose of the Extension and can navigate the flow.
- While it is required to provide a review channel link, you are not required to have your review channel live while waiting for your review to be complete. Extensions that allow the broadcaster to successfully configure the Extension with no use of an external application or game data connection do not require a continuously live review channel. Panel-only Extensions also do not require a continuously live review channel. If your Extension requires a specific game environment or backend service to be live for it to function, please provide your availability for review times within 9AM - 5PM PT in the Walkthrough Guide and Change Log. We will reach out and request another review time if we find that your review channel is not live at the time of the review.
- To improve the safety of the Twitch community regarding Content Security Policy (CSP) directives we added a new policy. Extensions developers must now set three new fields in the metadata of their Extension, “Allowlist for Image Domains”, “Allowlist for Media Domains”, and “Allowlist for URL Fetching Domains”. These fields will be used to define the allowed domains in the [CSP directives](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy). Here are some examples that would be acceptable for domain allowlisting:

- Public Hosted Site / Shared Hosting: when using AWS’s S3 the following URL would not be valid `https://s3.us-west-2.amazonaws.com/` as it applies to every S3 bucket available. However, if you include your unique bucket name, in any format accepted by the service (such as `https://s3.us-west-2.amazonaws.com/mybucket/` or `https://my-bucket.s3.us-west-2.amazonaws.com/`) they would be allowable.
- Private URL: `https://www.myextension.com`

## Template for a helpful Walkthrough Guide and Change Log  {#template-for-a-helpful-walkthrough-guide-and-change-log}

When submitting your Extension for review, you are required to submit a review channel. While the Change Log is useful for the review team to take note of new or altered features, UI or code changes, providing a Walkthrough Guide is just as essential for a timely review. This guide can include things like testing account credentials, your chosen code language, or even required applications for your Extension to be reviewed with minimized delays. We strongly recommend including a thorough Walkthrough Guide and itemized Change Log. Please feel free use this template below:

**[Information regarding backend allowlists, source code, game/app requirements for review, and/or test account details if account is required]**

This information is essential for the review team to complete your review in a timely manner. An example of the “source code” information needed is what technology/language your code is written in and if your code is not human-readable (i.e. obfuscated, minified, etc.) Please note: if your Extension does not contain human-readable code, please use [this form](https://forms.gle/pNcNjp7ZBA8G6hDs9) to submit your source code. If your Extension does not rely on any of these details, please make a note of this in the Walkthrough Guide and Change Log.

**[Changelog v X.X]**

This should be the changelog of the current version of your Extension in review. We recommend isolating this changelog to solely the changelog of the version you are submitting for review.

- Change 1
- Change 2
- Change 3
- And so on…

**[Steps for Testing the Extension]**

This should be the steps of testing all of your Extension’s functionality and features. Please note: if any of these steps are not intuitive for the broadcaster, the broadcaster may not be able to set up your Extension for use.

- Step 1
- Step 2
- Step 3
- And so on…

**[Optional: Video walkthrough of Extension configuration and viewer interaction]**

This should be a simple walkthrough of the Extension from configuration to viewer’s experience. The video can be hosted on any public video hosting site.

**[Optional: Developer’s Live Review Channel Times]**

This should be a block of time that you can make sure to be actively streaming on your channel with the correct Extension version enabled. If you do not provide these times, or if our team cannot perform your Extension review in the time you provided, our review team will reach out to get your availability.

**[Optional: Additional information for the review team]**

This should be any additional information that you think is essential for the review team to be able to complete your Extension review that hasn’t been covered with the above topics.

- Info 1
- Info 2
- Info 3
- And so on…

## Extensions and offsite links  {#extensions-and-offsite-links}

If a linkout directly enhances the experience of an Extension’s functionality or compliments content or data found in your Extension, it can be a great option. However, in order to pass policy review, there are a few things that you should not include in your linkouts:

- A landing page that has a call to action.
A call to action is referring to buttons or text that encourages users to do something such as: sign up, download, or register.
- A linkout to a social media website.
- A link to a site that is a competitor of Twitch.
- An advertising or sponsorship related page.
- A page whose content is unrelated to the Extension’s functionality.

We believe that if you can bring in more functionality and information through the Extension UI itself, you can create a more seamless viewer experience. This also ends up being a better outcome for streamers who are trying to maintain viewer numbers and channel engagement.

## How to write a great description  {#how-to-write-a-great-description}

A great Extension description is simple and straight to the point. However, there are a few key things it’s important include in your Extension description. Broadcasters need to know why they should install your Extension and what to expect when using your Extension.

- The foundation of your description should be a quick explanation of the core functionality it provides and the purpose your Extension serves.
- Focus on why a broadcaster should be excited to add this Extension to their list of favorite Extensions.
- If there is any functionality that may not be in the actual Extension yet, or may have been removed since the description was written, make sure that your description is updated.
- If your Extension has chat interaction functionality enabled and implemented, you will need to make sure that you clearly define in your Extension how it will be interacting with chat.
- If your Extension does not have any chat interaction functionality implemented, even if it is enabled, disable the “Has Chat” checkbox so the broadcaster isn’t alerted to chat functionality that doesn’t really exist.
- If your Extension has Bits functionality, you are not required to explain how the Bits exchange will work within your Extension. However, we recommend that you indicate somewhere that Bits are used so that the broadcaster is aware. If you do plan on mentioning Bits within your description, or any other part of your Extension, be sure that you are following the [Bits in Extensions policies](/docs/extensions/guidelines-and-policies/#6-bits-in-extensions), [Bits Acceptable Use policies](https://www.twitch.tv/p/legal/bits-acceptable-use/), and the Bits in Extension Best Practices.

Here is an example of a great Extension description to use for a reference:

| Tower builder is cool little mini-game for your viewers to play passively or actively while watching your channel. Every 5 minutes someone is watching your channel they gain one tower block. The tower has a visual animation play if a block is added, and the block counter shows them how tall their tower is. If someone wants to get more blocks faster, they can exchange Bits for blocks! There is a leaderboard view within the Extension that allows everyone to see who has built the tallest tower. Each time a viewer reaches the top spot of the leaderboard a message gets posted to chat for all to see! Who will have the Tallest tower in all the land? Find your master builder today! |
|---|

## Configuration clarity  {#configuration-clarity}

If your Extension requires configuration in order to activate it, putting in the extra effort to make this step user-friendly can help to increase adoption of your Extension. The configuration will be the first interaction that a broadcaster has with your Extension, and you want to make sure it makes a good impression! If the setup is confusing, or takes a long time to complete, it can be frustrating for a broadcaster looking for more of a plug and play solution. For game-matched Extensions, do not assume that there are steps or terminology that everyone who plays that game will know. Simplicity is key.

Ways that you can make configuration intuitive include:

- Keep as much of the configuration experience within the configuration page as possible. The less the broadcaster has to download, or register for accounts on a website, the easier it is.
- Use tabs on the configuration page to organize and filter different setup steps or customizations (i.e. setup tab, customization tab, information tab).
- Provide example text for any fields that need to be filled out by the broadcaster, such as required URLs or account credentials.
- Provide context for each option or requirement within the configuration page.
- Use an indicator to signify configuration was successful or unsuccessful. If a broadcaster needs to update something on the configuration page and a save is required to complete configuration, or if no configuration changes are needed, make this clear to the broadcaster.
- Notify the broadcaster if the live configuration is needed in addition to the regular configuration or if it can be useful for future updates.

## Branding and emotes  {#branding-and-emotes}

Everyone wants to make sure that they are getting credit for the hard work they do, and Twitch is no exception. It is best to steer clear of using Twitch-branded content, such as the Twitch Glitch, Twitch Logo, or Twitch’s global Emotes in your Extension. If you have original images or emotes, we would be happy to see those included in an Extension to make viewer engagement more personal and exciting.

For more information about what content specifically is not allowed within your Extension, review our [Guidelines and Policies](/docs/extensions/guidelines-and-policies).

## Content in Extensions  {#content-in-extensions}

Extensions help create opportunities for broadcasters to interact with their audience and provide a wide range of added functionality. The following guidelines will help developers find the right type of anchor for their Extension’s functionality:

**Overlay**: We want experiences in the overlay type to be interactive and/or content-enhancing for the stream. Below we have provided a list of expected functionality for a global overlay Extension and an example of each. A global overlay Extension is any Extension that can be installed on any Twitch channel (i.e. it does not specify a broadcaster allowlist).

- **Change the outcome of what is happening on the screen/stream**

- Allowing the players to make Mario run faster while playing “Super Mario Bros”
- Stream interaction via voting to change the outcome of what is happening on the stream
- **Enhances the content on the stream**

- Providing more information about the game being played such as live stats for a tournament, or information about cards that are displayed on screen in a Hearthstone match
- **Interact with the Extension**

- Having the user click on the stream to have hearts, claps, or stickers appear for the broadcaster and other viewers to see
- **Requires the full video space based on the Extension/users interactions**

- Showing the broadcaster “heatmap data” for where users are clicking on the video player
- Displaying captions from the stream audio to increase the accessibility for the viewers

**Component**: Should display information related to or relevant to what is happening on the stream.

**Panel**: Extensions without any interaction should live in a panel.

For more information about Content, please review our [Guidelines and Policies](/docs/extensions/guidelines-and-policies#4-content-policy).

## Commerce in Extensions  {#commerce-in-extensions}

Monetary transactions completed via a payment flow from within an Extension are not permitted. This means that any embedded payment options such as Amazon Pay, PayPal, or Stripe, will cause your Extension review to fail. Additionally, linking viewers to a web page where they can purchase items or services on a third-party website will also cause the Extension review to fail.

For more information about Commerce, please review our [Guidelines and Policies](/docs/extensions/guidelines-and-policies#5-commerce).

## Bits in Extensions  {#bits-in-extensions}

Bits are a fantastic way to help monetize your Extension while also giving broadcasters a way to provide a premium experience. However, there are some things that you will need to watch out for in order to pass review. First, we recommend you familiarize yourself with the [Bits in Extensions](/docs/extensions/guidelines-and-policies/#6-bits-in-extensions) and the [Bits Acceptable Use](https://www.twitch.tv/p/legal/bits-acceptable-use/) policies. Once you have done that, read through the tips we have listed for you to help get your Extension through the review process without hitting any speed-bumps:

- Make it clear what the Bits are being used for, and how they will be used within the Extension by providing context within your Extension description.
- Terminology that is typically approved when referencing Bits: get, win, use, exchange, amount, give, earn.
- Do not use the following terminology when referencing Bits: cost, spend, donate, support, insert, sell, price, buy, purchase, cheering, betting.

It is a good idea to look through your Extension one last time before submitting for review to ensure that all references to Bits adhere to the policies. Following the policies increases your chance of having your Bits-enabled Extension approved.

Another thing to keep in mind is that not all broadcasters will have Bits usage enabled on their channel. Bits can only be enabled on Partner or Affiliate channels that have opted in to use them. Before allowing the broadcaster to activate the Extension we recommend doing a check to see if their channel has opted into Bits usage. If they have not opted in, we recommend implementing one of the following options:

- Disable all Bits functionality within your Extension
- Hide or replace the functionality with a free version
- Do not allow the Extension to even be activated

We believe that utilizing one of these options will create less confusion for viewers trying to use Extensions where Bits functionality is not available due to the broadcaster not having Bits usage enabled. It will also create an environment where the broadcaster has less to worry about or to explain to viewers who may have trouble with your Extension.

## Moderation API  {#moderation-api}

Extensions that enable users to generate their own content creates exciting new ways for broadcasters to interact with their community. For these Extensions, we strongly recommend implementing the following features to provide a safer experience for broadcasters and engaged viewers. To help assist with implementing these safety parameters, Twitch offers [Moderation APIs](/docs/api/reference/#get-moderators).

- **Authentication** - Ask the user to grant authentication permissions before being able to submit any content through the Extension
- **Attribution** - Any content, submitted by a viewer through your extension, that will be shown to the broadcaster or other viewers on the channel should have the Twitch username of the submitter clearly displayed. This is so that the moderators can take action if necessary.
- **Chat Ban Support** - Any chat bans or timeouts for a viewer on the broadcaster’s channel should be honored by the extension. Any banned or suspended viewer should not be permitted to submit content that will be shown to the broadcaster or other viewers on the channel.
- **Banned User Content Removal** - If a user is banned, all of their content that can be seen by other users and has been submitted through the Extension should be removed. If the user is timed out the content they submitted through the Extension does not need to be removed.
- **Enforcement Filtering** - All text content submitted through the Extension must also pass through the enforcement endpoint which will determine if the submitted content meets the channel’s AutoMod requirements.
- **Retroactive Manual Removal** - Moderators should be able to remove any content that has been submitted through the Extension.
- **Proactive Review** - If your Extension allows content submitted by a viewer to be shown to the broadcaster or other viewers on the channel, it should provide an option for the broadcaster and/or their moderators to approve or deny the content submission before it is seen by other viewers.
- **Content History** - All user-generated content being submitted through the Extension should be posted to chat. For information on the chat API click [here](https://blog.twitch.tv/extensions-capabilities-in-twitch-chat-2ecbd53764d9).

## Requesting user permissions  {#requesting-user-permissions}

Requesting users to share their ID and grant permissions to your Extension might be necessary for users to use all or some of your Extension’s functionality. Keep in mind that user privacy is a big deal and some users may be hesitant to grant permissions to something that they are unfamiliar with.

In order for users to understand why they are being asked for permissions within your Extension, we recommend that you only request the permissions you need at the time that you need them. This way users should have a better idea of what their ID is needed for and might feel more comfortable sharing their ID.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
