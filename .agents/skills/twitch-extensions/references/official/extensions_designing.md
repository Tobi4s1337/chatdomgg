<!-- source: https://dev.twitch.tv/docs/extensions/designing/ -->

Contents

# Designing Extensions  {#designing-extensions}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

## Introduction  {#introduction}

If you are just getting started with Extensions, use the recommendations in this guide to put your best foot forward for streamers. If you already shipped an extension, use this guide to take your extension to the next level; e.g., with other extension types, such as panel or video overlay.

## General Guidelines  {#general-guidelines}

Extensions provide new ways to interact on Twitch, so we provide guidelines to help ensure your experiences are harmonious with the overall Twitch experience.

The guidelines in this section apply to all extension types. Guidelines for specific extension types appear in Panel Extension Guidelines, Video Overlay Extension Guidelines, Mobile Guidelines, and Pop Out Guidelines.

### Terminology  {#terminology}

The following table contains terms you will need to understand when you’re designing an extension. All the terms are specified in the Extensions Manager.

| Term | Guidelines |
|---|---|
| The extension’s **Name** is how you define what streamers know it as. The name can show up in many places, such as the Extensions manager and the details page. | Use a descriptive name that allows streamers to understand what your extension does at a glance.  Don’t change the name, unless the nature of the extension has changed significantly.   Don’t use words unrelated to your extension just to boost your extension in search results. |
| The **Summary** is a short description of your extension that streamers see when hovering over the discovery splash screen in the Extensions manager. The right summary helps them decide to install the extension. | Use as a selling point the most important benefit to a streamer using your extension.  Be concise. Don’t try to explain everything your extension does in the summary. |
| The **Description** is a longer explanation of your extension. It appears on the details page. | Write the description from your streamer’s viewpoint. Let streamers know how your extension will improve and enhance their channels.  Consider writing in the second person (using you/your), to more closely associate with streamers.  Don’t be too verbose. |
| The **Discovery Image** is the first thing streamers see of your extension. The Extensions manager shows this splash screen in the Discovery tab on a broadcaster’s dashboard. | Don’t use a lot of text; that overwhelms the image.  Avoid having too much detail in the image, to maximize visibility.  Avoid transparency in your PNG. |
| **Screenshot Images** are your best tool to help streamers understand how your extension works, if they haven’t seen it on someone’s channel. | Provide clear images that display how your extension works. |
| You are required to choose a **General Category** for your extension. | If your extension fits in more than one category, choose the most appropriate one.  Don’t choose a category that your extension clearly does not match - for example, specifying the “Schedule and Countdowns” category for a Destiny 2 gear extension. |
| If your extension supports specific games, you can indicate which ones under **Game Category**. | List only those games your extension supports. |

### Introduce Your Extension to Streamers  {#introduce-your-extension-to-streamers}

The Twitch Extensions directory showcases all Extensions available to broadcasters, letting them see examples of each extension as it would appear on their channels as a panel, video overlay, or video component.

### Simplify Onboarding and First-time Use  {#simplify-onboarding-and-first-time-use}

Once the extension is configured and installed, simplify onboarding for viewers to increase their engagement. For video-based Extensions, a subtle animation can be used to draw the viewer’s eye to engage with your experience. For panel Extensions, consider a splash screen explaining the extension’s capability (unless it is an informational extension, such as one that dynamically displays the top cheerers on a stream).

Extensions should not be distracting (remember the <blink> tag?), but it is appropriate to provide small clues; e.g., subtle bounces to indicate interactivity, and brief flashes to indicate state changes. A distracting extension focuses the viewer’s attention on your extension, away from the broadcast. This paradigm is still new and might require a little training of Twitch viewers.

If your extension requires some setup by viewers, consider disclosing those steps progressively throughout the experience: ask for only the information you need to get to the next step, rather than all the information up front. This includes asking for authorization from a viewer to share the viewer’s user name with the extension. Ask the viewer to authorize only when the extension requires the user name to continue. Also, it helps to explain to the user the value of the extension and why the extension requires user names, before asking for authorization.

### Amplify Broadcasters  {#amplify-broadcasters}

First and foremost, fans come to Twitch to engage with broadcasters. If broadcasters find that an extension will help grow their channels, they are more likely to install it. Some Extensions may provide utilities that are widely applicable to many broadcasters; e.g. leaderboards and top viewers. Other Extensions, like those made for a specific game, will have smaller audiences; that’s okay! Regardless, serving broadcasters first increases the likelihood of your extension being a part of their channel’s experience.

Panel extensions have the unique capability to be always on, regardless of whether the streamer is online. We provide a JavaScript helper function that lets you see if a broadcaster is online, which you can use to change the experience of your extension. For example, a panel extension showing a leaderboard of viewer engagement could filter by the users attending the broadcast, versus overall top engagement when the streamer is offline.

### Complement the Stream UI  {#complement-the-stream-ui}

The channel stream real estate may limit how your extension appears or is placed on the video. Top streamers often leverage broadcasting studio apps (like OBS) to create brand elements, animations, and live content to augment the broadcast. Given the shared space that Extensions occupy, assume that a streamer is leveraging tools like OBS to create a canvas that may interfere with the area where your extension UI will appear. Following this assumption, Extensions should include configuration options for broadcasters to align the experience with their channel’s branding. Consider allowing color, font and other UI customizations, to ensure your extension blends in with the overall experience.

Consider including extension capabilities that can be minimized or hidden by users, and only take up areas of the real estate that make sense given the content a streamer broadcasts. For example, a Hearthstone stream has most of its action in the middle of the board, so occupying the top right of the video will ensure your extension does not interfere with the game’s content. However, if your extension augments the information about the game and may require placement closer to the content on video, make sure it can be collapsed, to ensure you limit its interference with the content/game.

### Fail Gracefully and Take Feedback Well  {#fail-gracefully-and-take-feedback-well}

With potentially hundreds of thousands of users interacting with your extension every day, there is a chance your extension will have issues. Even relatively simple Extensions (like those that display the gear a streamer uses to create a broadcast) can have hundreds of failure points. Just like any app, anticipating general failures helps build user trust.

Apps should handle 404 or 500 errors by providing ways for viewers to provide feedback and leverage some other part of your extension. Apps that fail to retrieve data also should allow users to provide feedback. Streamers control the placement and use of extensions, so your extension should be prepared to accept feedback directly. If you don’t provide support, Twitch may find it necessary to remove your extension from the directory.

### Choose the Right Extension Type  {#choose-the-right-extension-type}

Throughout this guide, we provide guidelines for using different types of Extensions, but in general, consider:

- Content — How does your extension expand stream content? Does it relate to a game, or does it integrate with other apps (like those that play music)? Content may also help you decide where to place an extension. For example, a panel may be the best way to display content related to your channel panel, whereas a video overlay may be best for content related to a specific game.
- Context — Does your extension depend on real-time interaction? Does it need the streamer’s help to attract attention? Answers to questions like these help determine whether to place your extension next to the stream or in a panel.

### UI Recommendations  {#ui-recommendations}

- **Branding** — Your extension’s branding should be clean, recognizable, and unique. In general, use your logo sparingly and use brand color to enhance your brand on Twitch. Your extension cannot include Twitch-branded elements, including the Twitch or Glitch logos.
- **Color** — Use a limited color palette. If your extension is for a specific game, use a complimentary color palette where appropriate. For a video-overlay extension, consider how it will blend into the content behind the extension (video, game data, or other stream-overlay components). Use a key color for emphasis and calls to action. Avoid using the same colors for interactive and noninteractive elements. We discourage the use of Twitch’s color palette, unless:

- The extension includes buttons that invoke Twitch specific actions such as following a streamer or taking a clip.
- You are supporting light vs. dark mode for panel Extensions.
- **Contrast and accessibility** — Always provide enough contrast between colors, to ensure your designs are as accessible as possible. Avoid links on backgrounds that are of similar contrast. Consider your color-blind audience. We recommend you use [this contrast checker tool](https://webaim.org/resources/contrastchecker/).
- **Layout** — Use alignment and hierarchy for ease of visual scanning. Optimal layout depends on the type(s) of Extensions you make available for broadcasters; see the sections below.
- **Typography** — Use font weight, size, and color for emphasis. If possible, try to use a single font; using multiple fonts can make your extension feel fragmented. Instead, use font styling (bold, italic) and a limited number of font sizes. Use built-in browser fonts: they perform best and and work on all browsers. Here are some Web-safe fonts:

- Serif: Georgia, Palatino Linotype, Times New Roman
- Sans serif: Arial, Helvetica, Impact, Lucida Sans Unicode, Lucida Grande, Tahoma, Geneva, Trebuchet MS, Verdana
- **Stateful feedback** — Preload wherever possible.

- Overlays: Preload is especially important for Overlays, but you should avoid the use of “loading” indicators, which can interfere with the viewing experience.
- Panels: If a panel extension needs to display a loading state, design the loading state to be as clear and concise as possible. Consider adding a loading indicator. Use status indicators to communicate updates, errors, and other issues; your audience should not have to guess what is going on.
- **Navigation** — In general, avoid multi-layered navigations. If you cannot, then provide a clear path to let users know where they are. Ask yourself if each navigation element is necessary.

## Panel Extension Guidelines  {#panel-extension-guidelines}

A panel extension appears in the panel area below the video player. Panel Extensions remain active even when the channel is not live.

Follow these guidelines for Panels:

- **Online/offline** — Consider how panels work offline, as well as online. Panels can provide a continued reason for viewers to stay on a stream, even if the streamer is offline.
- **Uses beyond game content** — Since panels do not reside on video content, they do not have to be as tightly coupled to the streamer’s content as other types of Extensions. Panels are great for displaying high-level stats about the stream, gear a streamer uses, or other enjoyable content that has no relationship to the content they stream. Panels also can be treated like a mobile web app, housing a game or productivity app..
- **Layout** — Panel Extensions are limited to 318px wide x 496px high, to avoid iframe scrolling. Within these limits, try to allow 10px of inner padding for any text within your extension, for maximum readability.
- **Light vs. dark mode** — Twitch allows users to switch between the default light theme and a dark theme. Responding to this preference ensures your extension does not stand out in a channel UI when users change their preferences. Below are example palettes we use for Twitch to support light and dark mode. You can listen for a user switching between light and dark mode using the [onContext](/docs/extensions/reference/#oncontext)JavaScript helper function.

If you want to support light and dark mode, we recommend the following background colors:

| Attribute Name | Light Mode Background Color | Dark Mode Background Color |
|---|---|---|
| Background Color | White #fff | Twitch Dark Purple #201c2b |
| Background Color - Accent | Twitch Purple #6441A4 | Twitch Purple #6441A4 |

Here are recommended text colors, when supporting light and dark mode:

| Attribute Name | Light Mode Text Color | Dark Mode Text Color |
|---|---|---|
| Default Text | Twitch Dark Grey #232127 | Twitch Light Grey #e5e3e8 |
| Links | Twitch Purple #6441A4 | Twitch Light Purple #e2dbf0 |
| Text Overlays | Twitch Light Grey #e5e3e8 | Twitch Light Grey #e5e3e8 |

## Video-Overlay Extensions  {#video-overlay-extensions}

Video-overlay Extensions are meant to enhance the viewer’s experience, so be aware that each extension element covers valuable real estate.

- **Sizing** — When designing your extension UI, take into consideration that it needs to scale and adapt when the browser and video player resize. By default, a video-overlay extension functions at all sizes while the broadcaster is live. Consider hiding your extension when the size is reduced to a point that the extension becomes non-functional.
- **Covering up player elements** — If you have extension UI elements over the Twitch video player, interactions with those elements may not work. Here is a diagram of areas to consider when you design your video-overlay extension - placing elements in the purple areas may cause conflicts with the video player UI:

- **iFrame boundaries** — For drag-and-drop elements, consider how your video-overlay extension will respond when a user tries to move an element outside the video player’s viewing area. Design your extension to block elements from being relocated to outside the viewing area and/or force them to “spring” back into the viewing area.
- **Disabling** — A video-overlay extension disables itself when the broadcaster goes offline or hosts another channel. When a viewer pauses the video, the extension iframe is hidden until the viewer un-pauses the video.o.
- **Player control layers** — Keep in mind that your video-overlay extension will be rendered below all our video-player controls, such as pop-up menus, mouseovers, LIVE indicator, and channel information in the top left of popout/embed versions of the video player. Remember that theater mode, full screen, and embed have different UI layouts than the “normal” Twitch player.

## Mobile Guidelines  {#mobile-guidelines}

When designing mobile Extensions, consider the basic principles of any mobile application:

- **Your layout should be fluid** — Your extension’s layout should gracefully adapt to the available space. Do not assume any specific aspect ratio or dimension.
- **Design for touch** — Make sure interface elements that are actionable can be comfortably reached. Evaluate the tap target sizes and their relation to neighboring actionable elements. Consider a target size of no less than 44 pt/dp.
- **Reduce noise** — Trying to pack all your Extensions’ capabilities in the limited real estate will overload users with too much information. Bring in only the essential components of the experience. Limit buttons, images, and text that will be in view. Disclose actions progressively and contextually.
- **Navigation should be obvious** — If you are incorporating sub-navigation in your Extensions, make it obvious, with common mobile navigation patterns and affordances. If you do implement a navigation, indicate to users where they are within the extension, to keep them grounded.
- **Interface elements should be clear and visible** — Color and contrast are important in helping users understand the different elements of your extension. Take into account the visual hierarchy and proper spacing and text size for legibility.

For guidance, here are some examples.

### Optimized Extension Example  {#optimized-extension-example}

Here are notes on the optimizations:

### Alignment Example  {#alignment-example}

### Phones (Landscape View)  {#phones-landscape-view}

### iPhone X (Aspect Ratio: 19:5:9)  {#iphone-x-aspect-ratio-1959}

## Pop Out  {#pop-out}

To optimize the layout of pop-out Extensions, consider the following:

- **Your layout should be fluid** — As with mobile design, your pop-out extension’s layout should gracefully adapt to the available space. Do not assume any specific aspect ratio or dimension.
- **Consider opportunities to take advantage of additional real estate** — When popped out, an extension initially is displayed in the native size shown on the original page. Since viewers can resize the new window as desired, extension developers with pop-out support may control more screen real estate than the original extension size..

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
