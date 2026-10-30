<!-- source: https://dev.twitch.tv/docs/tutorials/extension-101-tutorial-series/create-extension/ -->

Contents

# Extension 101 tutorial series

# Create an Extension  {#create-an-extension}

Let’s get started by setting up the Extension up via the Extensions Console.

### Two-factor Authentication  {#two-factor-authentication}

- If you do not already have a Twitch account, go to [twitch.tv](https://twitch.tv/) in a browser and create an account using the **Sign Up** button in the top right of the page.
- You will need to enable two-factor authentication on your account to build Extensions, so please visit your [Security and Privacy settings](https://www.twitch.tv/settings/security) to confirm it is enabled or activate it.

### Creating the Extension in the Console  {#creating-the-extension-in-the-console}

- Go to the [Extensions Developer Console](https://dev.twitch.tv/console/extensions). From this console, you can start the process of creating a new Extension, view and clone your Extensions, and manage specific versions of your Extension(s). Login with your Twitch ID. You should see a page like this:
- Click the **Create an Extension** button on the right side of the page.
- Fill in the **Name Your Extension** section with any name you want, and then click **Continue**.
- On this versions page, be sure to fill out respective fields

- **Type of Extension** — (Required) Select **Panel**.
- **Version Number** — (Required) Leave this as 0.0.1.
- **Summary** — (Optional) This will be viewable by broadcasters and viewers. It should be 1-2 brief sentences describing what your Extension does. To provide more detail, use the Description.
- **Description** — (Optional) More detail than the Summary about the functions of your Extension.
- **Author Name** — (Optional) The full name of the Extension author or organization that will receive credit on the Extensions manager.
- **Author Email** — (Optional) Contact information for the Extension creator. This is used to contact the developer with information about the Extension’s life cycle (e.g., reject/accept notifications). Twitch will never reveal this email to anyone on the site. If you provide this information, you’ll get a verification email soon after creating the Extension version. Be sure to check your email, as you need to verify ownership of the author email address.
- **Support Email** — (Optional) Public contact information for support-related queries from broadcasters.
- Click **Create Extension Version**. You will then see the Status page of the Extension Manager. This page essentially shows the current status (Local Test) of the Extension in the Extension Life Cycle, and also provides you with next steps to move the Extension through the life cycle. You should see the following page:

### Concept: Extension Life Cycle  {#concept-extension-life-cycle}

The Extension Life Cycle details the various development stages of an Extension. You can [find more information](https://dev.twitch.tv/docs/extensions/life-cycle/) about each of these stages in our documentation.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
