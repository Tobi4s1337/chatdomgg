<!-- source: https://dev.twitch.tv/docs/tutorials/extension-101-tutorial-series/file-structure/ -->

Contents

# Extension 101 tutorial series

# Extension File Structure and HTML Views  {#extension-file-structure-and-html-views}

## Environment Set-Up  {#environment-set-up}

In this section, we are going to start building the Extension. But before that, you need to download the starter code from the following Github repository using the green Clone or Download button here: [https://github.com/sonia145/Extensions-101](https://github.com/sonia145/Extensions-101).

Your Extension’s directory should look something like this:

```
Would You Rather
  - config.html
  - panel.html
  - live_config.html
  - config.js
  - viewer.js
  - live_config.js
  - common.js
  - backend.js

```

Save these files in a local directory. Feel free to open these files up in a text editor and follow along as we walk through the basic front-end architecture of the Extension.

**Important!** This code is intentionally incomplete and there are active development steps, but if you get stuck, frustrated, bored, or are running low on time, you can instantly warp to the next step by switching branches. For example, to complete step two and skip to step three, either:

- Click **step-two** on github.com and download those files if you prefer downloading, or
- If you cloned the repository type `git checkout step-two` while in the directory where you cloned the workshop files, and then copy this new code to replace the files in your Extension directory.

## Step 1: Basic Front-end Architecture  {#step-1-basic-front-end-architecture}

The front end is composed of HTML, JS, and CSS files. Every Extension needs to be comprised of at least two front-end pages: the viewer and configuration page. The viewer page is what the viewers will see and interact with on the broadcaster’s channel, and the configuration page is what the broadcaster sees when they are going through the Extension configuration process, which is a one-time setup when installing the Extension on their channel for the first time.

There is an additional front end for the broadcaster’s live experience. In our WYR Extension, we are going to start with these three front-ends:

- **Viewer Page** (panel.html): viewers will be able to build their own WYR questions from a list of options, and submit them to the broadcaster.
- **Live Configuration Page** (live_config.html): as viewers submit their WYR questions, they will be shown to the broadcaster in real-time via this page.
- **Configuration Page** (config.html): the broadcaster will be able to see all the possible WYR options, and then only choose the ones that they would feel comfortable answering.

**Important**: Each page must load the Extension Helper Library, which is created and hosted by Twitch. This library provides methods for dealing with various critical services like authorization. You can see how this library is embedded in Line 43 of the config.html file.

### Further Consideration  {#further-consideration}

If you look in the file directory, you see that we call the viewer page, panel.html. We do this to clarify that this is specifically for the panel version of the Extension. We could also have another viewer page that supports another Extension type, such as an overlay. This allows developers to build out the same Extension in various different formats without needing to create a new Extension.On the broadcaster side, they can choose what type of extension format they want to activate on their channel. This information is sent as a [query parameter](https://dev.twitch.tv/docs/extensions/reference/#client-query-parameters) to the Extension window. This concept is called **Dynamic Anchors**.

## Step 2: Viewer Page  {#step-2-viewer-page}

The purpose of the viewer page is for the viewers to be able to engage in a creative process of building a WYR dilemma, and then submit their question to the broadcaster. From a viewer’s perspective, they will see the following page:

In `panel.html`, we have created a form with select tags to provide two drop down lists. Through this user interface, the viewer can create their own WYR dilemma from options provided in drop down menus. Upon clicking submit, the viewer’s question will be saved.

## Step 3: Live Configuration Page  {#step-3-live-configuration-page}

Through the live configuration page, broadcasters will be able to see the WYR questions coming in live from viewers.

In `live_config.html`, we have a button that the broadcaster clicks on to to view the submitted questions. Once selected, a vertical table of questions will be shown to the viewer.

## Step 4: Configuration Page  {#step-4-configuration-page}

Through the broadcaster’s configuration page, they will be able to select options they would like viewers to be able to choose from.

In `config.html`, you will see that a basic fieldset form is already created that allows the broadcaster to select what WYR options viewers will be able to select from. All options are defaulted to checked so that it’s easier for the broadcaster to simply opt out of a certain option.

### Further Consideration  {#further-consideration-1}

As you can see from the HTML file, we are manually writing these options in as individual checkboxes. However, if we wanted to include more options without manually writing them in, we could use a backend service to save the options and just request for them to be shown on page load.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
