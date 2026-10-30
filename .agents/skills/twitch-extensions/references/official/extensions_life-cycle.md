<!-- source: https://dev.twitch.tv/docs/extensions/life-cycle/ -->

Contents

# Extensions Life Cycle Management  {#extensions-life-cycle-management}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

## Local Test  {#local-test}

Every version of every Extension begins in Local Test. All assets such as HTML, JavaScript, CSS, images, and fonts are served from the testing base URI that is defined on the [Asset Hosting](/docs/extensions/life-cycle/#asset-hosting) tab of the Extensions Manager. To locally test your Extension, you need a local Web server. Since some operations require HTTPS, you need to create and install a self-signed certificate on your system.

In Local Test, you can install your Extension on your own channel, in the Extension Manager section of the streamer dashboard. If you are directed to configure the Extension, see [Required Configurations](/docs/extensions/building/#required-configurations). Click **Activate**. Then you can test your Extension.

## Twitch CDN & Hosted Test  {#twitch-cdn--hosted-test}

When you’re satisfied with the locally-hosted test version, upload your Extension’s assets to and begin serving them from the Twitch CDN. Then you can transition the version to Hosted Test, to test that the Extension still works when served from Twitch.

If you are in Hosted Test and want to change any of your Extension version details, you must move back to Local Test.

In both Local Test and Hosted Test, Extensions are visible only to a developer-provided list of test accounts and a small subset of Twitch staff. Other viewers see your channel without any Extensions.

## Review  {#review}

Once you complete the hosted test, you can submit the version for Review. While in review, all test accounts can continue to test the Extension as before.

Only one version of an Extension can be in Review at a time. Once a version is in Review, the only way to change it is to go back to Local Test, make changes, upload the assets again, then re-submit the version for review. Bear in mind that re-submitting resets your place in the review queue.

Currently, expected review times for Extensions are 8-14 days. Keep in mind weekends and US holidays as they may stretch the review times beyond your initial expectations.

## Post Review: Pending, Rejected, or Approved  {#post-review-pending-rejected-or-approved}

After an Extension version is reviewed by Twitch, it is placed into one of three states:

- **Pending Action** means revisions are required. You are contacted at the email address you provided and told any the reason the Extension was not approved. You can then take the extension back to a test state, iterate on the issues, and re-submit for review. You do not need to create a new version.
- **Rejected** means Twitch views the Extension as inappropriate and will not accept it. The Extension’s Client ID, which is a unique identifier, is permanently revoked. Rejected is a terminal state.
- **Approved** means you can release your Extension at any time. You can go back to a test state if desired, but you will have to go through another full review cycle.

## Released  {#released}

When a new version is Released, it goes live and can no longer be updated, only replaced with a new version. Only one version of an Extension can be released at a time: any prior released version is transitioned to Deprecated, and any installations of it are immediately upgraded. When you release a new version:

- Be aware that some viewers or streamers may be using the old version at that very moment.
- Ensure your Extension Backend Service (EBS) can handle traffic from older versions that are not yet refreshed.

## Moving from Local Test to Hosted Test  {#moving-from-local-test-to-hosted-test}

In order to move an Extension from local test to hosted test, you need to enter the required fields listed in the following table.

| Extensions Manager Tab | Required Fields | Optional Fields |
|---|---|---|
| Monetization | - Bits Support (default: No) - Subscription Support (default: No) | N/A |
| Files | - Version Assets | N/A |
| Access | N/A | - Streamer Allowlist - Testing Account Allowlist |

## Moving from Hosted Test to Review  {#moving-from-hosted-test-to-review}

In order to move an Extension from hosted test to review, you need to enter the required fields listed in the following table.

**Note:** While we require you to provide a review channel link, you are not required to have your review channel live while waiting for your review to be complete. Extensions that allow the broadcaster to successfully configure the Extension with no use of an external application or game data connection do not require a continuously-live review channel. Panel-only Extensions also do not require a continuously-live review channel. If your Extension requires a specific game environment or backend service to be live for it to function, please provide your availability for review times within 9AM - 5PM PT in the Walkthrough Guide and Change Log. We will reach out and request another review time if we find that your review channel is not live at the time of the review.

| Extensions Manager Tab | Required Fields | Optional Fields |
|---|---|---|
| Status  (a pop-up screen appears when you submit for review) | - Extension Review Channel URL | - Walkthrough Guide and Change Log |
| Version Details | - Name - Summary - Description - Author Name - General Category - Logo Image - Taskbar Icon Image (video-component Extensions only) - Discovery Image - Screenshot Image - Author Email - EULA or Terms of Service URL - Privacy Policy URL | - Game Category (required for Extensions integrated with a game; otherwise, optional) - Support Email |
| Capabilities | - Request Identity Link - Chat Capabilities - Select how you will configure your Extension | - Developer Writable Channel Segment Configuration - Streamer Writable Channel Segment Configuration - Allowlist URLs - Allowlisted Panel URLs |
| Asset Hosting | - Testing Base URI - Type of Extension - Viewer Path - Panel Height - Video - Fullscreen View Path - Config Path | - Live Config Path |

## Updating after Release  {#updating-after-release}

To update an Extension after it has been released, create a new version and submit it for review. This process does not affect the version of your Extension that is live. To create a new version, go to your Extensions developer console and do one of the following:

- Click on the Extension to be updated, to open a page listing all versions of that Extension. Click **Create New Version**.
The system copies all information from the prior version to the new one.
- Clone any previous version, to use as the basis for your new version.

## Deleting an Extension  {#deleting-an-extension}

If you decide to stop supporting your Extension, you can delete it. Deleting an Extension is not reversible, and you can’t delete specific versions of an Extension.

To delete an Extension, go to the Extensions developer console, then:

- Find the Extension you want to delete.
- Click **Extension Authorization Settings**.
- Click **Delete Extension**.
This will delete all installations and activations of all versions of the Extension.

## Pre-Release Disclosures  {#pre-release-disclosures}

Viewers will not be able to use an Extension until they agree to the Extension disclosures that are visible on your channel page. These disclosures are removed when viewers install a reviewed and approved Extension that is listed in the Extension Directory.

## Extensions Manager Overview  {#extensions-manager-overview}

Use the Extensions Manager to create new Extensions and make changes to existing Extensions:

- Open the Extensions Manager: In your Extensions console, select any version of any Extension and click **Manage**.
- On every page of the Extensions Manager, you see the state of your Extension and next steps to move through the Extension life cycle.
- Follow the instructions for the Extensions Manager tabs: Status, Version Details, Capabilities, Monetization, Files, Asset Hosting, and Access.

### Status  {#status}

The Status tab indicates where in the Extensions life cycle your Extension is and what steps you can take next. Depending on where your Extension is in the life cycle, different information and buttons appear on this page to indicate, for example, how to add information required before you can move to the next life-cycle stage.

When you click to submit your Extension for review, you are prompted to enter the following information:

| UI Item | Description |
|---|---|
| Extension Review Channel URL | URL of the Twitch channel where the Extensions review team will test your Extension. |
| Walkthrough Guide and Change Log | With your first version, submit a clear, thorough guide that describes Extension functionality and how you expect viewers to use it. For subsequent versions, include a change log. Failure to provide these may result in delayed review or rejection. |

### Version Details  {#version-details}

Most of the information on the Version Details tab is displayed in the Discovery tab on a streamer’s dashboard. For tips on using discovery to your best advantage, see [Designing Extensions](/docs/extensions/designing/).

There are three categories of fields to be entered: general settings, image assets, and miscellaneous other fields.

**General Settings**

| Field | Description |
|---|---|
| Name | Your Extension’s name. |
| Summary | This will be viewable by streamers and viewers. It should be 1-2 brief sentences describing what your Extension does. |
| Description | More detail than the Summary about the functions of your Extension. |
| Author Name | The full name of the Extension author or organization that will receive credit in the Extensions Manager. |
| General Category | If your Extension fits in more than one category, chose the most appropriate one. Don’t choose a category that your Extension clearly does not fit into. The drop-down list has these categories:    - **Extension for Games**: Extensions that are built specifically to support games, either a specific game or many games. - **Games in Extensions**: Extensions that contain games. - **Schedule and Countdowns**: Extensions that allow broadcasters to communicate to their communities their next event or stream. - **Polling and Voting**: Extensions that enable broadcasters to get viewer feedback. - **Loyalty and Recognition**: Extensions that help viewers use loyalty points or provide a way for them to be recognized in the channel, such as a leaderboard. - **Music**: Extensions that enable broadcasters to show their current song or enable viewers to request songs from the broadcaster. - **Viewer Engagement**: Extensions that provide different ways for viewers to engage, and do not fall into another category - **Streamer Tools**: Extensions that do not fall into another category. |
| Game Category | If your Extension supports specific games, you can indicate which ones here. Select up to 15 games. Start typing and the field will list available options. List only those games your Extension supports.    This field is required for Extensions integrated with a game. |

**Image Assets**

| Field | Description |
|---|---|
| Logo Image | Add a logo for your Extension. This must be a 100x100 PNG. Do not use Twitch or Glitch logos. If you do not have a logo, a default logo is assigned. |
| Taskbar Icon Image | (Video-component Extensions only) This icon appears at the bottom of the stream, indicating which Extension is active. This must be a 24x24 PNG. |
| Discovery Image | This splash screen is the first thing streamers see of your Extension. The Extensions Manager shows this image in the Discovery tab on a streamer’s dashboard. This must be a 300x200 PNG. Tips:  - Don’t use a lot of text; that overwhelms the image. - To maximize visibility, avoid having too much detail in the image. - Avoid transparency in your PNG. |
| Screenshot Image | Screenshots are your best tool to help streamers understand how your Extension works, if they haven’t seen it on someone’s channel. You must include one or more screenshots when you submit an Extension for review. Provide clear images that display your Extension in action. Images can be PNG, JPG, or GIF. The minimum (and recommended) image size is 1024x768. Images must have a 4:3 aspect ratio. Files must be less than 10MB. |

**Other Fields**

| Field | Description |
|---|---|
| Author Email | Contact information for the Extension creator. This is used to contact the developer with information about the Extension’s lifecycle. Twitch will never reveal this email to anyone on the site.  After you submit this information, you will get a verification email. Be sure to click on the link in the email. If you have not done this, you will not get email notifications about file-upload issues or Extension approval. |
| Support Email | Public contact information for support-related queries from streamers. |
| EULA or Terms of Service URL | Reference URL for your End User License Agreement or Terms of Service. |
| Privacy Policy URL | Reference URL for your privacy policy |

### Capabilities  {#capabilities}

| Miscellaneous Fields | Description |
|---|---|
| Request Identity Link | Default: **No**. Select **Yes** if your Extension needs to know the viewer’s numeric Twitch ID. Once the viewer accepts your request to share their Twitch identity, the viewer’s numeric Twitch ID is provided in the Extension Helper’s `onAuthorized`callback function. For details about these callbacks and the JWT format, see the [Extensions Reference](/docs/extensions/reference). |
| Chat Capabilities | Default: **No**. Select **Yes** only if your Extension calls [Send Extension Chat Message](/docs/api/reference#send-extension-chat-message). If you select this, be sure to include details of your Extension’s chat functionality in your Extension description. |

| Configuration Fields | Description |
|---|---|
| Select how you will configure your Extension | Default: **Extensions Configuration Service**. Select the source of the configuration for your Extension.    **No configuration**: Choose this if your Extension has no need for per-channel customization.    **Custom/My Own Service**: Your Extension Backend Service provides the configuration. If you choose this, you can have the option to specify another field:    - **Required Per Channel Configuration**: Use this to require that a streamer successfully configure your Extension before activation is allowed. This can be useful if, for example, an active Extension would show a confusing error message to all viewers if misconfigured. The contents of this string can be whatever you want. This is covered further in [Creating Your Extension Backend Service (EBS)](/docs/extensions/building/#creating-your-extension-backend-service-ebs).   **Extensions Configuration Service**: Your Extension will use a Twitch-hosted configuration. For more information, see [Configuration Service](/docs/extensions/building/#using-the-configuration-service). |
| Developer Writable Channel Segment Configuration, Streamer Writable Channel Segment Configuration | These fields provide additional required configuration information. Specify these only if **Extensions Configuration Service** is selected as your configuration method. See instructions on the UI. |
| Allowlist Config URLs, Allowlisted Panel URLs | If your Extension is required to open an external URL for configuration or as a core functionality for the panel, list the URLs here. See information about off-site linking in [Extensions Guidelines & Policies](https://dev.twitch.tv/docs/extensions/guidelines-and-policies). |

### Monetization  {#monetization}

Select how you will configure your Extension:

| Field | Description |
|---|---|
| Will you monetize your Extension? | Default: **No Bits support.** Indicates whether your Extension can accept Bits. |
| Subscription Status | Default: **No** **subscription support**. Indicates whether your Extension can get a viewer’s subscription status. |

### Extension Monetization within Organizations  {#extension-monetization-within-organizations}

Developers who wish to collaboratively build and manage Extensions can do so within an Organization. Monetization is handled by billing managers appointed by organization owners. For more information and to get started, see the [Organizations Guide](/docs/companies).

### Files  {#files}

| Field | Description |
|---|---|
| Upload Version Assets | Before you can transition your Extension to Hosted Test, you must upload your assets to the Twitch CDN. Version assets must be a .zip format. The ZIP file cannot contain executable formats or files other than assets required to run the Extension.  Be sure to also update the Asset Hosting tab with the file paths specified in the ZIP directory, so we can properly serve your assets on twitch.tv. |

### Asset Hosting  {#asset-hosting}

**Content Security Policy (CSP)**

When an Extension is being hosted on Twitch, you must adhere to certain content security policies:

- You cannot run inline scripts without a nonce/hash.
- You cannot use iFrames within your Extension.
- You can use either HTTPS or WSS to connect to external sources such as an EBS.
- You cannot have fonts or scripts hosted outside of the Extension files except for Google Fonts and Google Analytics.
- Fonts can only be loaded as a local file or by using Google Fonts. If using a local font and Webpack, Webpack’s url-loader will convert fonts under a specified size to a base64 URI, which will violate the CSP. To resolve this, use file-loader instead.

**CSP for Reference**

```
connect-src https: wss: https://*.google-analytics.com https://stats.g.doubleclick.net https://www.googletagmanager.com blob:; default-src 'self' https://0btmbqa5tm2pyr0f59td8vk1unwxl6.ext-twitch.tv; block-all-mixed-content; img-src * data: blob:; media-src * data: blob:; frame-ancestors https://supervisor.ext-twitch.tv https://extension-files.twitch.tv https://*.twitch.tv https://*.twitch.tech https://localhost.twitch.tv:* https://localhost.twitch.tech:* http://localhost.rig.twitch.tv:*; font-src https://0btmbqa5tm2pyr0f59td8vk1unwxl6.ext-twitch.tv https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://0btmbqa5tm2pyr0f59td8vk1unwxl6.ext-twitch.tv https://fonts.googleapis.com; script-src 'self' https://0btmbqa5tm2pyr0f59td8vk1unwxl6.ext-twitch.tv https://extension-files.twitch.tv https://*.google-analytics.com https://www.googletagmanager.com;

```

| Field | Description |
|---|---|
| Testing Base URI | Change this to reflect the root URI for all assets related to this Extension version. The URI must end with a forward slash.  The URI is completely up to you; it need not match the version in any way. During test, assets are served directly from this URI, so you can update your code without re-submitting anything. |
| Type of Extension | Select one or more types: Panel, Video - Fullscreen, Video - Component, or mobile. |
| Viewer Path | Path to the HTML file that is shown to viewers on the channel page. There is a path box for each item selected under **Type of Extension**. |
| Panel Height | Default: **300.** This appears only for panel Extensions. It is the panel height in pixels. The range is 100-500. |
| Video - Fullscreen View Path | This appears only for video-overlay Extensions. It is the path to the HTML file shown to viewers on the channel page when the Extension is activated as a video overlay. This path should be relative to the Testing Base URI. |
| Config Path | Path to the HTML file that is shown to streamers while they are configuring the Extension but before activating it within the Extensions Manager. This page is displayed in an iframe with a dynamic width (up to 1100px) and a dynamic height. This should be a path relative to the testing base URI. It should be used for infrequent, install-time configuration. |
| Live Config Path (Optional) | Path to the HTML file that is shown to streamers in the Live module of the dashboard. It is used for streamer actions taken while the Extension is active, such as creating a new poll. It should be a path relative to the testing base URI.  If the live configuration view is specified or set, it will be enabled for [pop-out control](/docs/extensions/required-technical-background/#pop-out-extensions). |

### Access  {#access}

The fields on the Access tab require comma-separated lists of account IDs, not names. To convert account names to account IDs, use the [Get Users](/docs/api/reference#get-users) endpoint with account names (i.e. login) to return all associated account IDs.

| Fields | Description |
|---|---|
| Streamer Allowlist | Account IDs in this list are the only Twitch streamers who can install this Extension after release using the **Invite Only** tab on the streamer’s Extensions Manager. If this field is blank, any Twitch user can install this Extension using the Extension Discovery Directory.  Be sure to check your allowlist before submitting your Extension for review. If your Extension has allowlisted streamers when you submit it for review, the approved Extension is visible only to those streamers. After review, changing the allowlist requires re-submitting your Extension for review. |
| Testing Account Allowlist | Account IDs of streamers who will be able to install and activate the Extension on their channels and view the Extension on any channel where it is activated. By default, you can install, activate, and view this Extension on your channel  Adding IDs here prevents streamers outside the allowlist from installing the Extension once it is approved. If this is list empty or missing, all streamers can use the Extension. Accounts on the Testing Account Allowlist can install the Extension even if they are not on the Streamer Allowlist. |

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
