<!-- source: https://dev.twitch.tv/docs/extensions/monetization-strategies/ -->

Contents

# Monetization Strategies  {#monetization-strategies}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

Monetization can be an important component of a Twitch Extension, ensuring developers can continue to iterate on great experiences while also providing streamers with additional revenue mechanisms. By effectively implementing Twitch’s built-in monetization features, you can create a successful flywheel involving all aspects of the community; viewers receive rewarding interactions, streamers gain enhanced content and Bits revenue, and developers earn a share of the Bits revenue that can contribute to future development. This guide explores advanced strategies for optimizing this revenue opportunity.

Extensions provide a blank canvas for interactivity and can greatly add to a creator’s stream through personalized interactions, celebrating key moments, and collaboration. Bits, in particular, offer a low-friction way for viewers to directly support the streamer and engage via your Extension in a meaningful way. A thoughtful monetization strategy is more than just a way to send Bits; it’s a core part of the user experience. A well-designed Bits experience can provide repeatability and retention for Twitch viewers who want to contribute to a streamer’s content.

## Strategies for Bits Revenue  {#strategies-for-bits-revenue}

Iterating beyond simple effects for Bits can be challenging. Here are a few techniques that may help optimize Bits usage in your Extension and encourage more engagement.

### Default Configurations: Bits Usage at Activation  {#default-configurations-bits-usage-at-activation}

Streamers often activate Extensions, but can easily delay or forget to configure them. Default configurations ensure that Extensions are functional and monetizable from the moment it’s activated.

To help streamers get started quickly with engagement and monetization, provide some interactions that are immediately available for viewers. This approach prevents an unusable, un-configured Extension experience and allows an audience to begin supporting a streamer through the Extension with Bits. Default interactions also serve as the catalyst for streamers to later explore and customize their settings to meet their needs.

### Viewer Customization: The Value of Recognition  {#viewer-customization-the-value-of-recognition}

Cosmetic offerings allow viewers to differentiate their actions from others, providing a powerful incentive for using Bits. Consider designing your Extension in a way that enables viewers to uniquely present their actions. This could be a name color, a unique icon, a border around their message, or a custom animation that levels up their action. This personalization fosters a sense of ownership and pride, making viewers more likely to contribute and stand out within the community.

### Limited Time Offers: Urgency / Retention  {#limited-time-offers-urgency--retention}

Scarcity and exclusivity are powerful psychological drivers in commerce, and they are equally effective for digital goods.

Regularly introduce new, time-limited items, effects, or abilities. These can be tied to:

- **Real-world events**: Holidays, seasons, or major gaming launches.
- **Channel events**: A streamer’s birthday, anniversary, or subscriber milestone.
- **Flash sales**: Short, unexpected promotions announced during a stream. This strategy gives viewers a reason to check back frequently and spend Bits before an opportunity disappears.

### Streamer-activated Sales: Discounts Incentivize Interaction  {#streamer-activated-sales-discounts-incentivize-interaction}

Temporary price reductions are an excellent tool for boosting transaction volume and attracting viewers who might be hesitant to spend at full price.These sales can dramatically increase the total number of transactions, often resulting in higher overall Bits revenue.

Allow the streamer to quickly and easily trigger a sale at their own discretion.This can be done either by a percentage or a fixed amount. Sales are highly effective at making premium features accessible to a wider audience, especially to users who may be price averse. A well-timed sale can revitalize interest in an extension and convert casual viewers into active participants.

### Community Bits Goals: Collaborative Achievements  {#community-bits-goals-collaborative-achievements}

Community goals transform individual transactions into a collaborative effort, unlocking experiences that no single viewer could trigger alone.

Instead of requiring a single viewer to contribute a large sum of Bits, create shared goals where the entire chat pools their Bits together to achieve a common objective. Going the extra mile by visualizing this progress, Be it with a bar or thermometer within UI, will allow the community to gauge how close they are to triggering a given interaction. This approach fosters a sense of shared purpose and makes large-scale interactions more frequent and engaging for the entire community.

## Leveraging Channel Subscriptions  {#leveraging-channel-subscriptions}

While Bits drive transactional revenue, Channel Subscriptions can provide predictable monthly support. Consider unlockable features when a Twitch user subscribes to a Twitch account that you own and operate.

Integrating subscriber-only features is an opportunity to add more value to your Extension. A subscription can be designed to provide features for the streamer using your Extension or the viewers interacting with your Extension. We suggest focusing on providing different features for streamers versus viewers. This allows your most engaged users a way to directly show their support.

The value provided to subscribers should be additive and not detract from the core experience for non-subscribers. Consider exclusive customization options, access to special interactions, or reduced cooldowns on Bits triggers; not gating essential functionality.

### Designing for Subscriptions  {#designing-for-subscriptions}

Here are a couple of considerations when designing subscription-based features for your Extension.

- **Tiered Benefits**: Offer different perks for Tier 1, Tier 2, and Tier 3 subscribers. For example:
- **Tier 1**: Access to a subscriber-only color in the extension.
- **Tier 2**: A monthly free use of a premium Bits interaction.
- **Tier 3**: Their name highlighted on a permanent “VIP” board within the extension.
- **Clear Communication**: Always clearly label which features are available to subscribers and at which tier. This manages viewer and streamer expectations and acts as an incentive to subscribe.

By thoughtfully implementing these strategies for both Bits and subscriptions, you can create a robust monetization model that benefits everyone in the Twitch community.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
