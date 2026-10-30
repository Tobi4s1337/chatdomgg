<!-- source: https://dev.twitch.tv/docs/extensions/a-b-testing-in-extensions/ -->

Contents

# Using A/B Testing in Extensions  {#using-ab-testing-in-extensions}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

## Introduction  {#introduction}

A/B testing is a method of testing the performance of different variants of a web-page that is shown to users at random. Developers can analyze the resulting test statistics to see which page variant helped users achieve a predetermined conversion goal - for example, a completed purchase.

The process of implementing A/B testing has four steps:

## Step 1: Identify your Goal  {#step-1-identify-your-goal}

Identify the goal of your A/B testing. For example, are you interested in whether users click a certain link or button, or do you want to follow a user’s “page-path” through the extension (the sequence of pages a user clicks while navigating through an extension)?

## Step 2: Create a Variation  {#step-2-create-a-variation}

- Statistically identify the population for each variation. For example, you can split a population into two groups by performing an odd/even check on broadcaster ID.
- For each of the resulting groups, enable or disable a feature in your front end.
- Use conditional styling (CSS) to hide or display different elements in each group.

## Step 3: Monitor User Behavior in your Extension  {#step-3-monitor-user-behavior-in-your-extension}

Record events as users interact with your extension. For example, record the button clicks or page-path mentioned in Step 1.

## Step 4: Analyze Results and Draw Conclusions  {#step-4-analyze-results-and-draw-conclusions}

Analyze the data you collected. If there is a clear winner, deploy it. If the test is inconclusive, see what insights you can draw from your data and test them in subsequent rounds of A/B tests.

## Sample Code  {#sample-code}

```
twitch.ext.onAuthorized(function (auth) {
  //Let’s assume this returns a valid TUID by decoding the token
  tuid = getUserID(auth.token);
  // enable the GREEN button for even number Broadcaster ID
  if (value%2 == 0){
      $('#redButton).hide();
    $('#greenButton).show();
  }
  else{
     $('#redButton).show();
    $('#greenButton).hide();
  }
});

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
