<!-- source: https://dev.twitch.tv/docs/extensions/using-google-analytics-in-extensions/ -->

Contents

# Using Google Analytics in Extensions  {#using-google-analytics-in-extensions}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

## Introduction  {#introduction}

This guide explains the high-level steps needed to enable Google Analytics to track events from within your Extension.

This guide does not cover Safari on Mac and the Twitch iOS app.

## Configuring your Extension to Use Google Analytics  {#configuring-your-extension-to-use-google-analytics}

- Set up your [Google Analytics account](https://support.google.com/analytics/answer/1008015?hl=en).
- Track events by adding `analytics.js` for events in your extension. The sample code below explains where to load the `analytics.js` file. Since Twitch extensions do not allow inline Javascript, you will need to load and configure the `analytics.js` library from within a bundled Javascript file.
- Use [event measurement](https://developers.google.com/analytics/devguides/collection/analyticsjs/events) to track events on each page of your extension

Some examples of events are loading of a page, clicking on a link or a button, and expanding or closing a section.

## Note on GDPR  {#note-on-gdpr}

Google Analytics collects user IP data by default. Since this is considered personal data under GDPR (General Data Protection Regulation), we strongly recommend that developers anonymize the user’s IP address in their applications. The sample below demonstrates how to implement this.

## Sample Code  {#sample-code}

To illustrate the steps in this guide, we have used a panel extension with the following directory structure:

```
GA Extension/
|
|__js/
| |__mobile.js
| |__viewer.js
| |
|__css/
| |__style.css
|
|__panel.html
|__overlay.html
|__component.html

```

## Next Steps  {#next-steps}

First, add `analytics.js` to your `viewer.js` file:

```
(​function​(i,s,o,g,r,a,m){i[​'GoogleAnalyticsObject'​]=r;i[r]=i[r]||​function​(){ (i[r].q=i[r].q||[]).push(arguments)},i[r].l=​1​*​new​ ​Date​();a=s.createElement(o), m=s.getElementsByTagName(o)[​0​];a.async=​1​;a.src=g;m.parentNode.insertBefore(a,m) })(window,document,​'script'​,​'https://www.google-analytics.com/analytics.js'​,​'ga'​);
ga(​'create'​, ​'UA-123456-1'​, {
    cookieFlags: 'max-age=7200;secure;samesite=none'
}​);
ga(​'set'​, ​'anonymizeIp'​, ​true​);

```

Second, send a page-load event to Google Analytics via JavaScript:

```
$(document).ready(function() {
    //Send page load event to GA
    ga('send', 'event', 'Load', 'Load_'+$("#pageViewHeader").text(), 'PageLoaded');
  });

```

Third, send the event to Google Analytics via JavaScript:

```
$(document).ready(function() {
    //Send button click event to GA
    $("button").click(function() {
       $(this).find("span").text("I was CLICKED");
ga('send', 'event', 'Click', 'Click_'+$(this).attr("id"), 'ButtonClickDetail');

    });
  });

```

The code snippet above sends two events to Google Analytics. The first event is tied to the loading of a page; it sends the text of the element with the ID `pageViewHeader`. The second event fires when a button is clicked; it sends the ID of the button element.

Fourth, attach JavaScript to your panel HTML:

```
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="user-scalable=no, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width, height=device-height, shrink-to-fit=no">
    <script src="https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js"></script>
    <script src="js/viewer.js" type="text/javascript"></script>
    <link rel="stylesheet" type="text/css" href="css/style.css">
    <title>Viewer</title>
</head>

<body>
    <div  id="pageViewHeader">Hello world!</div>
    <div></div>
    <div>
        <button id="redButton" class="button button3"><span>Red Button</span></button>
    </div>
    <div></div>
    <div>
        <button id="greenButton" class="button"><span>Green Button</span></button>
    </div>
</body>
</html>

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
