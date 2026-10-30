<!-- source: https://dev.twitch.tv/docs/insights/ -->

Contents

# Insights & Analytics  {#insights--analytics}

## Introduction  {#introduction}

Twitch Insights provides game and extension developers with analytics data to help developers make data-driven decisions about future development. As a developer, you can use this data to enhance the experience of broadcasters and viewers and optimize how they engage with your games and extensions on Twitch

Once a data field is added to a report, it will not be deleted in future versions of the report. New data fields may be added in new versions of the report, anywhere in the sequence of fields (that is, not necessarily at the end of the CSV).

### Counting Device IDs  {#counting-device-ids}

As explained below, some unique data fields (for example, Unique Viewers) are collected based on device IDs. At a given moment, a device ID is assigned to a single hardware device. For example, if someone loads an extension or watches a game on 2 devices, that involves 2 device IDs and counts as 2 Unique Viewers.

Web browsers store device IDs using cookies. The half-life of a cookie seems to be about 14 days, even if you ask the browser to store the cookie forever. So, on any given day, we can assume that a browser always provides the same device ID for a given device. But over a month, most browsers provide at least 2 device IDs for the same device, one ID initially and another after clearing and refreshing the cookie.

This applies primarily to the web platform. Mobile apps and console platforms have different storage regimes, and device IDs are much more durable in those environments.

How does this affect Insights data collection? On a particular day, this has very little impact, as we can expect 1 device to have only 1 device ID. Over time, though, 1 device will have multiple device IDs. As a result, there is a significant impact on Insights data fields that count device IDs over long periods of time (30 days or more). For these fields, the number of uniques is likely to be much higher than the number you get by extrapolating from shorter time periods. The major impact is on the **Last 30 Days** data fields, especially if your game or extension is used primarily from web browsers. For example, for Extensions that run only in browsers, the number of Unique Viewers Last 30 Days will be much higher than the number of Unique Viewers times 30.

## Extension Developer Analytics  {#extension-developer-analytics}

To download this data:

 1. On your Twitch developer console, go to the **Extensions tab**.
 2. On the line for the extension for which you want data, click **Download CSV**.

Data is provided as one CSV file per released extension. The file contains one row of data per day, from January 31, 2018 until the current day. Fields related to minimization are provided only as of June 22, 2018 (as noted in the following table). The file contains all data fields in the latest version of Extension analytics.

Data starts being collected after the Extension is installed and viewed, subject to a one-day delay. For example, we start calculating the data for January 12 on January 14 at UTC 1:00. Typically the calculations complete within 1 hour. The report is uploaded as soon as the calculations are done.

Also see the [Get Extension Analytics](/docs/api/reference/#get-extension-analytics) endpoint in the Twitch API. The endpoint returns a URL that you can use to download the CSV files. The endpoint can be used to return any report type of Extension analytics data.

### Data Fields (Overview Reports)  {#data-fields-overview-reports}

All counts are for the corresponding day in the CSV file. If there is no data for a day, either that day is missing from the report or it is in the report with all data fields having a value of 0 (that is, no activity).

Except where noted, all metrics count events from desktop browsers, mobile browsers, and the Twitch app.

| Column Name | Description |
|---|---|
| Date | UTC date for the data in each row. For example, data in the row for 2018-08-01 (August 1, 2018) covers the period from 2018-08-01T00:00:00Z to 2018-08-01T23:59:59Z. |
| Extension Name | Name of the extension. Since the name can change and may take a few days to update internally, the Extension Client ID (which does not change) is preferable as an identifier. |
| Extension Client ID | Alphanumeric identifier for the extension. |
| Extension Details Page Visits | Number of visitor page loads of the extension’s Details page (https://www.twitch.tv/ext/<extension_id-version>. Reloading the page counts as multiple visits. |
| Unique Extension Details Page Visits | Number of unique visitor page loads of the extension’s Details page. Specifically this measures unique device IDs (see Counting Device IDs). |
| Installs | Number of install events of the extension. |
| Uninstalls | Number of uninstall events of the extension. |
| Activations | Number of activation events of the extension. |
| Unique Active Channels | Number of unique broadcaster channel IDs that had at least one render while the extension is active. This can be interpreted as the number of unique broadcasters that used your extension on their channel and received at least one viewer. If a broadcaster streams with your extension but the extension has no viewers, that is not captured here. |
| Unique Active Channels Last 7 Days | Number of Unique Active Channels in the past 7 days. For example, if this metric is provided on July 31, it would cover July 25-31. |
| Unique Active Channels Last 30 Days | Number of Unique Active Channels in the past 30 days. For example, if this metric is provided on July 31, it would cover July 2-31. |
| Unique Identity Links | Number of unique user IDs that granted the extension access to their Twitch user IDs. Users can grant and revoke access multiple times. On any given day, only the first grant is counted. |
| Unique Identity Unlinks | Number of unique users who revoked access to their Twitch user IDs. Users can grant and revoke access multiple times; on any given day, only the first revoke is counted. |
| Renders | Number of user page loads, watching channels with the extension. A page refresh counts as a render. |
| Unique Renderers | Number of unique users with a “renders” event. Specifically, this measures unique device IDs (see Counting Device IDs). |
| Unique Renderers Last 7 Days | Number of Unique Renderers in the past 7 days. For example, if this metric is provided on July 31, it would cover July 25-31. |
| Unique Renderers Last 30 Days | Number of Unique Renderers in the past 30 days. For example, if this metric is provided on July 31, it would cover July 2-31.Note this may be unexpectedly high; see Counting Device IDs. |
| Views | Number of times that 75% or more of the extension iframe was visible in any viewer’s browser. For panel extensions, this may be less than the number of renders, if the extension is rendered but the viewer does not scroll down to view it. Scrolling up and down multiple times does not count as multiple views. |
| Unique Viewers | Number of different viewers who watched this extension on Twitch, based on the Views definition above. Specifically, this measures unique device IDs (see Counting Device IDs).    If your extension is shown by a given device ID in multiple ways (panel, video overlay, video component), that counts as 2 Unique Viewers (1 for the panel and 1 for the video overlay and/or component). |
| Unique Viewers Last 7 Days | Number of Unique Viewers in the past 7 days. For example, if this metric is provided on July 31, it would cover July 25-31. |
| Unique Viewers Last 30 Days | Number of Unique Viewers in the past 30 days. For example, if this metric is provided on July 31, it would cover July 2-31. Note this may be unexpectedly high; see Counting Device IDs. |
| Mouseenters | Number of times a mouse pointer enters (hovers over) the extension. This counts only desktop browser events. |
| Unique Mouseenters | Number of unique Mouseenter events. Specifically, this measures unique device IDs (see Counting Device IDs). This counts only desktop browser events. |
| Unique Mouseenters Last 7 Days | Number of Unique Mouseenters in the past 7 days. For example, if this metric is provided on July 31, it would cover July 25-31. |
| Unique Mouseenters Last 30 Days | Number of Unique Mouseenters in the past 30 days. For example, if this metric is provided on July 31, it would cover July 2-31. |
| Mouseenters Per Viewer | Average number of Mouseenter events per viewer. Defined as Mouseenters / Unique Viewers |
| Mouseenter Rate | Indicates the ratio of Unique Viewers who also have mouseenter events. Defined as Unique Mouseenters / Unique Viewers. |
| Clicks* | Number of click events in the extension iframe. |
| Unique Interactors* | Number of unique click events in the extension iframe. Specifically, this measures unique device IDs (see Counting Device IDs). |
| Unique Interactors* Last 7 Days | Number of Unique Interactors in the past 7 days. For example, if this metric is provided on July 31, it would cover July 25-31. |
| Unique Interactors* Last 30 Days | Number of Unique Interactors in the past 30 days. For example, if this metric is provided on July 31, it would cover July 2-31. Note this may be unexpectedly high; see Counting Device IDs. |
| Clicks Per Interactor* | Average number of click events per interactor. Defined as: Clicks / Unique Interactors. |
| Interaction Rate* | Indicates the ratio of interactors to viewers. Defined as: Unique Interactors / Unique Viewers. |
| Minimizations | Number of times a viewer minimizes (hides) the extension. This field is provided from June 22, 2018 on. |
| Unique Minimizers | Number of times a viewer minimizes (hides) the extension. This field is provided from June 22, 2018 on. |
| Minimization Rate | Indicates how often viewers minimize the extension. Defined as Unique Minimizers / Unique Viewers. This field is provided from June 22, 2018 on. |
| Unminimizations | Number of times a viewer unhides the extension after it was minimized. Unminimizations can happen for extensions that were minimized in previous days. This field is provided from June 22, 2018 on. |
| Unique Unminimizers | Number of Unique Viewers that unhide the extension after it was minimized. This field is provided from June 22, 2018 on. |
| Unminimization Rate | Indicates how often viewers unhide the extension after it was minimized. Defined as Unique Unminimizers / Unique Viewers. This field is provided from June 22, 2018 on. |
| Bits Revenue USD | (Bits-enabled Extensions only) Revenue share earned by the developer from Bits transactions (in US dollars): this is Bits * 20% share * $.01/bit conversion rate. For more information about Bits in Extensions, see the Extensions Monetization Guide. |
| Bits Used | (Bits-enabled Extensions only) Number of Bits used. |
| Bits Transactions | (Bits-enabled Extensions only) Number of Bits transactions. |
| Bits Per Transaction | (Bits-enabled Extensions only) Average number of Bits per transaction. Defined as Bits Used / Bits Transactions. |
| Unique Bits Users | (Bits-enabled Extensions only) Number of unique users who used Bits in the extension. This is measured by user IDs, not device IDs. |
| Unique Bits Users Last 7 Days | (Bits-enabled Extensions only) Number of unique users who used Bits in the extension in the last 7 days. For example, if this metric is provided on July 31, it would cover July 25-31. This is measured by user IDs, not device IDs. |
| Unique Bits Users Last 30 Days | (Bits-enabled Extensions only) Number of unique users who used Bits in the extension in the last 30 days. For example, if this metric is provided on July 31, it would cover July 2-31. This is measured by user IDs, not device IDs. |
| Bits Used Per User | (Bits-enabled Extensions only) Average number of Bits per user. Defined as Bits Used / Unique Bits Users. |

**NOTE:** Click events will include false positives, as viewers often click into the player to reveal the Extension or other player controls. This is especially true for Overlay Extensions. You are allowed to implement Google Analytics to further instrument your Extension.

### Partial Sample File  {#partial-sample-file}

For brevity, in this sample file we show data for only 10 days.

```
Date,Extension Name,Extension Client ID,Extension Details Page Visits,Unique Extension Details Page Visits,Installs,Uninstalls,Activations,Unique Active Channels,Unique Active Channels Last 7 Days,Unique Active Channels Last 30 Days,Unique Identity Links,Unique Identity Unlinks,Renders,Unique Renderers,Unique Renderers Last 7 Days,Unique Renderers Last 30 Days,Views,Unique Viewers,Unique Viewers Last 7 Days,Unique Viewers Last 30 Days,Mouseenters,Unique Mouseenters,Unique Mouseenters Last 7 Days,Unique Mouseenters Last 30 Days,Mouseenters Per Viewer,Mouseenter Rate,Clicks,Unique Interactors,Unique Interactors Last 7 Days,Unique Interactors Last 30 Days,Clicks Per Interactor,Interaction Rate,Minimizations,Unique Minimizers,Minimization Rate,Unminimizations,Unique Unminimizers,Unminimization Rate,Bits Revenue USD,Bits Used,Bits Transactions,Bits Per Transaction,Unique Bits Users,Unique Bits Users Last 7 Days,Unique Bits Users Last 30 Days,Bits Used Per User
5/31/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz51,42,13,18,5,9,164,462,756,51,8,23954,13084,80730,168982,23954,13084,80730,168982,51796,7564,40166,79960,3.9587,0.5781,6512,1365,6848,15464,4.7707,0.1043,410,369,0.0282,12,10,0.0009,1.08,540,32,16.875,30,132,417,18
6/1/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz52,30,11,14,5,5,124,434,714,37,5,17286,9308,79066,163978,17286,9308,79066,163978,40010,5462,39166,77026,4.2985,0.5868,4412,1182,6926,14972,3.7327,0.127,292,273,0.0293,10,8,0.0011,0.87,435,38,11.4474,15,117,402,29
6/2/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz53,21,8,14,5,5,128,440,694,15,2,7930,5220,84282,163124,7930,5220,84282,163124,10516,2208,42176,75940,2.0146,0.423,1700,411,7636,14716,4.1363,0.0787,60,51,0.0098,4,4,0.0008,0.06,30,4,7.5,6,117,396,5
6/3/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz54,30,11,11,6,5,132,438,678,27,2,28412,21270,87358,165508,28412,21270,87358,165508,33464,7638,44426,76154,1.5733,0.3591,5356,1290,8760,14664,4.1519,0.0606,250,312,0.0147,4,4,0.0002,0.69,345,8,43.125,9,129,405,38.3333
6/4/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz55,31,10,16,4,8,184,442,654,51,6.5,31360,18238,80720,152212,31360,18238,80720,152212,62222,9678,44510,72208,3.4117,0.5307,7754,1986,10142,14124,3.9043,0.1089,466,477,0.0262,18,18,0.001,1.14,570,36,15.8333,33,162,408,17.2727
6/5/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz56,29,11,19,4,7,130,412,616,31,3.5,25562,14628,75620,147288,25562,14628,75620,147288,53390,7916,41896,69244,3.6498,0.5412,6670,1620,9414,13428,4.1173,0.1107,410,405,0.0277,2,2,0.0001,1.08,540,12,45,9,153,405,60
6/6/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz57,35,12,15,4,7,162,388,592,39,5,29130,18574,72038,144320,29130,18574,72038,144320,59696,10256,39912,66560,3.214,0.5522,7512,1884,8876,12836,3.9873,0.1014,458,507,0.0273,26,16,0.0014,1.32,660,58,11.3793,30,165,420,22
6/7/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz58,26,8,12,3,5,124,348,554,31,5,24184,14830,62452,138678,24184,14830,62452,138678,50960,7926,34506,61998,3.4363,0.5345,8434,1860,8056,12108,4.5344,0.1254,552,504,0.034,30,18,0.002,0.72,360,10,36,12,144,411,30
6/8/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz59,20,7,12,4,6,120,330,542,43,6.5,19732,12308,58580,133930,19732,12308,58580,133930,39890,6588,31670,59152,3.241,0.5353,7256,1560,7294,11356,4.6513,0.1267,436,468,0.038,14,14,0.0011,0.81,405,28,14.4643,18,150,411,22.5
6/9/2018,test extension,hs5z3fh5dxhshfhazhk4hq38g9hz60,24,8,12,3,7,134,324,538,41,6.5,30622,17092,56124,129834,30622,17092,56124,129834,63590,9626,29608,56998,3.7205,0.5632,11176,2493,6692,10768,4.483,0.1459,726,624,0.0365,16,14,0.0009,1.89,945,14,67.5,15,141,429,63

```

## Game Developer Analytics  {#game-developer-analytics}

Game Developer Analytics provides a full spectrum of your game’s performance on Twitch, including aggregate hours watched and number of concurrent streamers. It is available only to users who have registered an organization and claimed their game via the Twitch Developer Console. See [Organization Management](/docs/companies/) for more information.

To download this data:

- On your Twitch developer console, navigate to your organization console using the top navigation drop down. Then, click on the **Games** tab.
- Under the game for which you want data, click **Export Daily CSV**.

If the button does not appear, the game does not meet the minutes-watched threshold for report generation. A report is available only if the game was broadcast for at least 300 minutes (5 hours) over the time period covered by the report.

Data is provided as one CSV file per game. The file contains one row of data per day, for the past 365 days. The file contains all data fields in the latest version of game analytics.

Data starts being collected after the game is broadcast and viewed, subject to a one-day delay. For example, we start calculating the data for January 12 on January 14 at UTC 0:00. Typically the calculations complete within 4 hours. The report is uploaded as soon as the calculations are done.

Also see the [Get Game Analytics](/docs/api/reference/#get-game-analytics) endpoint in the Twitch API. The endpoint returns a URL that you can use to download the CSV files.

### Terminology  {#terminology}

| Term | Definition |
|---|---|
| Live | Live broadcast or premiere. |
| Not-Live | Rerun or VOD. |
| Rerun | Subsequent (not live) streaming of any past broadcast. |
| VOD | Video on Demand. VODs are asynchronous pieces of content that viewers can watch whenever they like. A VOD may be a past broadcast, a highlight of a past broadcast, an uploaded video, or a clip (short, non-live streams created by viewers).  Clips are not included in the developer analytics data described in this document. Clips data is available via the [Get Videos](/docs/api/reference#get-videos) API endpoint. |
| Vodcast | An old term, which at Twitch comprises what are now known as premieres and reruns. |

### Data Fields (Overview Reports)  {#data-fields-overview-reports-1}

Note that all counts are for the corresponding day in the CSV file.

If there is no data for a day, either that day is missing from the report or it is in the report with all data fields having a value of 0 (i.e., no activity).

| Column Name | Description |
|---|---|
| Date | UTC date for the data in each row. For example, data in the row for 2018-08-01 (August 1, 2018) covers the period from 2018-08-01T00:00:00Z to 2018-08-01T23:59:59Z. |
| Game | Name of the game. |
| Game ID | ID of the game. |
| Total Views | Sum of Live Views + Not-Live Views. |
| Live Views | Number of times any stream of this game was viewed on Twitch, live. This includes live streams and Premieres. If someone watches a game 5 separate times in a day, that counts as 5 views here. |
| Not-Live Views | Number of times any stream of this game was viewed on Twitch, not live. This includes Reruns and VODs. |
| Total Unique Viewers | Number of different viewers who watched this game on Twitch live or not-live. Specifically this measures unique device IDs (see Counting Device IDs). |
| Live Unique Viewers | Number of Unique Viewers who watched this game live on Twitch. Specifically this measures unique device IDs (see Counting Device IDs). |
| Not-Live Unique Viewers | Number of Unique Viewers who watched this game not-live on Twitch. As above, this measures unique device IDs (see Counting Device IDs). |
| Average Concurrent Viewers | Average number of concurrent CCUs of this game, across Twitch. |
| Peak Concurrent Viewers | Peak number of concurrent viewers of this game, across Twitch. |
| Peak Time - Concurrent Viewers | UTC timestamp that corresponds to Peak Concurrent Viewers. |
| Total Hours Watched | Sum of Live Hours Watched + Not-Live Hours Watched. |
| Live Hours Watched | Number of hours this game was watched live on Twitch. |
| Not-Live Hours Watched | Number of hours this game was watched not-live on Twitch. |
| Unique Broadcasters | Number of unique broadcasters who live-streamed this game on Twitch. Specifically, this measures unique channel IDs. |
| Hours Broadcast | Number of hours of this game that were broadcast on Twitch live. |
| Average Concurrent Broadcasters | Average number of broadcasters simultaneously streaming this game. |
| Peak Concurrent Broadcasters | Peak number of broadcasters simultaneously streaming this game. |
| Peak Time - Concurrent Broadcasters | UTC timestamp that corresponds to Peak Concurrent Broadcasters. |
| Live Unique Chat Participants | Number of live unique chat participants for this game, across Twitch. |
| Total Live Chat Messages Sent | Number of chat messages for this game, across Twitch. |
| Unique Active Channels with Extensions | Number of unique broadcaster channel IDs streaming your game, which had at least one render while an extension was active. This can be interpreted as the number of unique broadcasters that used an extension on their channel and received at least one render while streaming your game. If a broadcaster streams with an extension but the extension does not render for any viewers, that is not captured here. |
| Unique Active Extensions | Number of unique extensions related to Unique Active Channels with Extensions. Note that while the report is game-specific, some of the extensions may not be specific to the game. |
| Clips Created | Number of Clips created from this game. |
| Clip Views | Number of times any Clips of this game were watched. |
| Top Clip URL | URL of the most-watched clip of this game. |
| Top Clip URL Embed | URL of the most-watched clip of this game, which you can embed in your site or blog. This is the same clip as for Top Clip URL, but the URL here contains additional parameters relevant to embedding clips (see [Non-Interactive Frames for Clips](/docs/embed/video-and-clips/#non-interactive-iframes-for-clips)). (Note: This URL contains a `tt_medium`parameter. Ignore this; it is used only internally by Twitch.) |

### Sample File (Partial)  {#sample-file-partial}

For brevity, in this sample file we show data for only 10 days.

```
Date,Game,Game ID,Total Views,Live Views,Not-Live Views,Total Unique Viewers,Live Unique Viewers,Not-Live Unique Viewers,Average Concurrent Viewers,Peak Concurrent Viewers,Peak Time - Concurrent Viewers,Total Hours Watched,Live Hours Watched,Not-Live Hours Watched,Unique Broadcasters,Hours Broadcast,Average Concurrent Broadcasters,Peak Concurrent Broadcasters,Peak Time - Concurrent Broadcasters,Live Unique Chat Participants,Total Live Chat Messages Sent,Unique Active Channels with Extensions,Unique Active Extensions,Clips Created,Clip Views,Top Clip URL,Top Clip URL Embed
1/1/18,TestGame,123456,30000,10000,20000,25893,19990,25550,12345,5103,6:41 AM,23234.09,1000.01,2000.04,100,213.18,23,12,12:00 AM,1675,10000,54,20,149,1000,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/2/18,TestGame,123456,30001,10001,20000,24239,19991,25551,14932,6018,12:00 AM,21093.45,1000.02,2012.34,92,199.34,45,21,12:00 AM,2345,10001,79,54,200,2000,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/3/18,TestGame,123456,30002,10002,20000,25552,19992,25552,13467,8012,12:00 AM,23234.09,1000.03,2024.64,40,220.09,10,34,12:00 AM,1321,10010,23,19,145,2001,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/4/18,TestGame,123456,30003,10003,20000,26789,19993,25553,12345,4521,12:00 AM,21093.45,1000.04,2036.94,55,79.08,23,12,12:00 AM,1234,10090,234,167,233,2010,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/5/18,TestGame,123456,30004,10004,20000,28908,19994,25554,14932,5103,12:00 AM,23234.09,1000.05,2049.24,65,213.18,45,21,12:00 AM,990,10000,54,20,50,2098,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/6/18,TestGame,123456,30005,10005,20000,28992,19995,25555,13467,6018,12:00 AM,21093.45,1000.06,2061.54,110,199.34,10,34,12:00 AM,1675,10001,79,54,149,1999,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/7/18,TestGame,123456,30006,10006,20000,24239,19996,25556,12345,8012,12:00 AM,23234.09,1000.07,2073.84,89,220.09,23,12,12:00 AM,2345,10010,23,19,200,1000,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/8/18,TestGame,123456,30007,10007,20000,25552,19997,25557,14932,5103,12:00 AM,21093.45,1000.08,2086.14,77,213.18,45,21,12:00 AM,1321,10090,234,167,145,2000,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/9/18,TestGame,123456,30008,10008,20000,26789,19998,25558,13467,6018,12:00 AM,23234.09,1000.09,2098.44,100,199.34,10,34,12:00 AM,1234,10000,54,40,233,2001,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
1/10/18,TestGame,123456,30009,10009,20000,28908,19999,25559,12345,8012,12:00 AM,21093.45,1000.1,2110.74,130,220.09,21,12,12:00 AM,990,10001,79,56,50,2010,https://clips.twitch.tv/dummyvideo?tt_medium=dx_insights,https://clips.twitch.tv/embed?clip=dummyvideodonotclick&tt_medium=dx_insights
...

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
