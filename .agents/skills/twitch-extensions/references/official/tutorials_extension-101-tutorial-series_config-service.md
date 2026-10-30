<!-- source: https://dev.twitch.tv/docs/tutorials/extension-101-tutorial-series/config-service/ -->

Contents

# Extension 101 tutorial series

# Configuration Service  {#configuration-service}

Now that we’ve set up the basic architecture of an Extension, let’s explore how different pages interact with each other. The first interaction we are going to look at is between the broadcaster’s configuration page and the viewer’s page. Specifically, we want to be able to save the broadcaster’s preferences for what WYR options should be shown to the viewers, and present those selected options to the viewer in the panel view. We can use the Twitch-provided Configuration Service to allow the broadcaster to customize the Extension.

**Key Concept**: We can think of the Configuration Service as a key-value pair service for basic data stores. By allowing the developer to easily read and write to a store, the Configuration Service helps developers because it:

- Removes the need for using a backend to store persistent per-channel and per-Extension specific information
- Stores user IDs to call third-party APIs from your backend (if you have one)
- Enables broadcasters to customize your Extension

## Step 1: Config View Logic  {#step-1-config-view-logic}

In the broadcaster’s configuration page, we can use jQuery to write a function that will retrieve all the selected options in the fieldset form we say in previous tutorial and then save them as an array. We need to add the following function to `config.js`:

## Step 2: Set Configuration  {#step-2-set-configuration}

We now need to write the saved broadcaster’s options that we saved as an array to the configuration service. To do this, we are going to use the `twitch.configuration.set` function from the Extensions Helper Library to essentially set the Extension Configuration.

**Key Concept**: An Extension configuration is made up of segments that consist of three values: type, Extension version, and configuration value. Segment types refer to who can read and write the configurations, and thus can be set to the broadcaster, developer, or global. More information on these types can be found in the documentation for the [configuration service](https://dev.twitch.tv/docs/extensions/building/#using-the-configuration-service).

For this Extension, the broadcaster is setting the configuration, for version one, and saving a value of options (needs to be saved as a string). Thus, we need to add the following function to the `config.js`.

For more information on the set function, check out the [Extension Helper Library](https://dev.twitch.tv/docs/extensions/reference#helper-configuration).

## Step 3: onChanged Configuration  {#step-3-onchanged-configuration}

The next thing is to render the broadcaster’s options in the viewer’s panel. We can access the configuration information that was set in the previous step through `twitch.configuration.broadcaster.content`. However, we should only access this information inside the `twitch.configuration.onChanged` function when the contents of the broadcaster variable have completely loaded. This `onChanged` function essentially is called when an Extension configuration is received, which happens only once, on extension load!

Once you have the contents of your configuration, you can parse the values and update the panel view. To do this, add the following function to `config.js` and `viewer.js`.

On line 11, you can see that we are calling a function called `updateOptions()`. This function is going to update the options on the viewer side. Let’s add this next!

## Step 4: PanelView Logic  {#step-4-panelview-logic}

We want the Extension to be able to save the WYR options that the broadcaster selected in `config.html` and provide them to the viewer’s interface, `panel.html`, as selectable options in the drop down menus. To do this, we need some basic javascript logic that will be able to take an array and present each item of the array as an option in the drop down menu. Add the following function to `common.js`.

Now that we’ve set up the Configuration Service, it’s time to test it.

**Check**: If you want to see the completed code at this stage, its available on the Step 1 branch.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
