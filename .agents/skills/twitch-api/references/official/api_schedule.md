<!-- source: https://dev.twitch.tv/docs/api/schedule/ -->

Contents

# Scheduling Broadcasts  {#scheduling-broadcasts}

While Twitch does not require scheduling a broadcast before you start your livestream, creating a broadcasting schedule provides viewers a useful calendar to understand when the broadcaster will go live next. To help manage the broadcaster’s schedule, the Twitch API provides a number of endpoints that developers can use to create an experience that displays and manages a broadcaster’s schedule.

A schedule is made up of one or more recurring and non-recurring segments. Recurring segments are broadcasts that stream weekly on the same weekday and time of day (for example, Fridays at 10:30 AM). Non-recurring segments are single event broadcasts.

[Read More](https://help.twitch.tv/s/article/channel-page-setup#Schedule)

## Getting the broadcaster’s streaming schedule  {#getting-the-broadcasters-streaming-schedule}

To get a broadcaster’s streaming schedule, use the [Get Channel Stream Schedule](/docs/api/reference#get-channel-stream-schedule) endpoint.

The request must include:

- An app or user access token.
- The broadcaster_id query parameter that’s set to the ID of the broadcaster whose streaming schedule you want to get.

The following example shows how to get a broadcaster’s schedule. The request returns segments that start after the current UTC date and time. To specify the date and time used in the request, see Getting segments by date.

```
curl -X GET 'https://api.twitch.tv/helix/schedule?broadcaster_id=123456' \
-H 'Authorization: Bearer nazuiljmm4vk3x1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uexdkjvtu49jjqm575f'

```

The following response shows that the broadcaster has scheduled 1) a 40 minute stream that occurs every Wednesday at 7:00 AM UTC (you know that it’s a recurring broadcast because the `is_recurring` field is set to **true**), 2) a 30 minute non-recurring stream that occurs on 24 August, and 3) a vacation for the month of September.

```
{
  "data": {
    "segments": [
      {
        "id": "eyJzZWdtZW50SUQiOiIzNiM2QwLTQwOTQtYWRlMy0zNzVjYTQ0ZjA1NWQiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozNH0=",
        "start_time": "2022-08-24T07:00:00Z",
        "end_time": "2022-08-24T07:40:00Z",
        "title": "Emira or Cayman?",
        "canceled_until": null,
        "category": 509658,
        "is_recurring": true
      },
      {
        "id": "eyJzZWdtZW50SUQiOiJlNjE4OTyLTQ4N2ItYWE2My03Y2I5NmNiZGU5MTgiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozNH0=",
        "start_time": "2022-08-24T07:45:00Z",
        "end_time": "2022-08-24T08:15:00Z",
        "title": "First Drive",
        "canceled_until": null,
        "category": 509658,
        "is_recurring": false
      },
      . . .
    ],
    "broadcaster_id": "123456",
    "broadcaster_name": "zippydodah",
    "broadcaster_login": "ZippyDoDah",
    "vacation": {
      "start_time": "2020-09-01T00:00:00Z",
      "end_time": "2020-09-30T23:59:59Z"
    }
  },
  "pagination": {
    "cursor": "eyJiIjpudWxsLCJhIjp7IkN1cnNvci..."
  }
}

```

If the broadcaster hasn’t scheduled any broadcasts, the request returns an HTTP 404 Not Found status code.

The number of occurrences in the response for a recurring segment is undetermined but may extend for years, so plan your pagination logic accordingly.

### Getting segments by ID  {#getting-segments-by-id}

If you know a segment’s ID, you can use it to get the segment’s data. You may specify a maximum of 100 IDs. To specify multiple IDs, repeat the id parameter for each segment you want to get. For example, `id=123&id=456&id=789`. The request doesn’t ignore duplicate IDs.

```
curl -X GET 'https://api.twitch.tv/helix/schedule?broadcaster_id=123456&id=eyJzZWdtZW50SUQiOiIxMzdkM2M2Ni1lM2QwLMTUiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjo0MX0=' \
-H 'Authorization: Bearer nazuilj4vk36jx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uekjvt7uu49jjqm575f'

```

The above ID returns the 11 October segment.

```
{
  "data": {
    "segments": [
      {
        "id":
        "eyJzZWdtZW50SUQiOiIxMzdkM2M2Ni1lM2QwLMTUiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjo0MX0=",
        "start_time": "2022-10-11T06:00:00Z",
        "end_time": "2022-10-11T06:30:00Z",
        "title": "30 minutes of talking nonsense",
        "canceled_until": null,
        "category": null,
        "is_recurring": true
      }
    ],
    "broadcaster_id": "88776655",
    "broadcaster_name": "chitterchatter",
    "broadcaster_login": "ChitterChatter",
    "vacation": {
      "start_time": "2022-08-08T00:00:00Z",
      "end_time": "2022-09-16T00:00:00Z"
    }
  },
  "pagination": {}
}

```

Because the above segment is part of a recurring broadcast, if you include the start_time query parameter in the above request and set it to 1 August (`2022-08-01T00:00:00Z`), it returns the next broadcast segment that occurs on or after 1 August. In this case, the recurring broadcast occurs on Tuesdays, so the response contains the 2 August segment of the recurring broadcast.

```
{
  "data": {
    "segments": [
      {
        "id": "eyJzZWdtZW50SUQiOiIxMzdkM2M2Ni1lM2QwLMTUiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozMX0==",
        "start_time": "2022-08-02T06:00:00Z",
        "end_time": "2022-08-02T06:30:00Z",
        "title": "30 minutes of talking nonsense",
        "canceled_until": null,
        "category": null,
        "is_recurring": true
      }
    ],
    "broadcaster_id": "88776655",
    "broadcaster_name": "chitterchatter",
    "broadcaster_login": "ChitterChatter",
    "vacation": {
      "start_time": "2022-08-08T00:00:00Z",
      "end_time": "2022-09-16T00:00:00Z"
    }
  },
  "pagination": {}
}

```

### Getting segments by date  {#getting-segments-by-date}

By default, when you get the broadcaster’s schedule, it returns scheduled segments starting from the current UTC date and time. For example, if the UTC date and time is 8:15 PM on 23 August, the response contains segments that start on or after 8:15 PM on 23 August. This means that if the broadcaster also scheduled a 1:00 PM broadcast on 23 August, the response wouldn’t include it. To ensure that the response contains the entire day’s schedule, use the start_time query parameter and set the time portion to zeroes.

```
curl -X GET 'https://api.twitch.tv/helix/schedule?broadcaster_id=123456&start_time=2022-08-23T00:00:00Z' \
-H 'Authorization: Bearer nazuiljmm436jx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8udkjvt7uu49jjqm575f'

```

You may use the start_time parameter to get the broadcaster’s past or future scheduled segments. For example, if the current month is August and you want to preview their September schedule, use `start_time=2022-09-01T00:00:00Z`.

## Setting your vacation schedule  {#setting-your-vacation-schedule}

It’s a good idea to let your viewers know when you’re going on vacation, so they can plan accordingly. To set your planned vacation, use the [Update Channel Stream Schedule](/docs/api/reference#update-channel-stream-schedule) endpoint.

The request must include:

- A user access token that includes the **channel:manage:schedule** scope.
- The broadcaster_id query parameter that’s set to the ID of the broadcaster who wants to set their vacation schedule.
- An object in the request body with the following fields:

- The `is_vacation_enabled` field that’s set to **true**.
- The `vacation_start_time` field that’s set to the day that the broadcaster’s vacation starts.
- The `vacation_end_time` field that’s set to the day that the broadcaster’s vacation ends.
- The `timezone` field that’s set to the time zone where the broadcaster is located. Specify the time zone using [IANA time zone database](https://www.iana.org/time-zones) format.

The following example shows how to specify the broadcaster’s vacation schedule.

```
curl -X PATCH 'https://api.twitch.tv/helix/schedule/settings?broadcaster_id=123456' \
-H 'Authorization: Bearer nazuiljmm4vkjx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uexdkjvuu49jjqm575f' \
-H 'Content-Type: application/json' \
-d '{"is_vacation_enabled":true,"vacation_start_time":"2022-10-01T00:00:00Z","vacation_end_time":"2023-04-30T23:59:59Z","timezone":"America/Los_Angeles"}'

```

Scheduling a vacation doesn’t:

- Affect the broadcaster’s existing streaming schedule; it doesn’t remove or cancel the segments within the scheduled vacation.
- Prevent you from adding a streaming segment that falls within the scheduled vacation.

When the broadcaster’s vacation is over, remember to remove the vacation schedule by setting is_vacation_enabled to **false**.

```
curl -X PATCH 'https://api.twitch.tv/helix/schedule/settings?broadcaster_id=123456' \
-H 'Authorization: Bearer nazuiljmm4vkjx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uexdkjvuu49jjqm575f' \
-H 'Content-Type: application/json' \
-d '{"is_vacation_enabled":false}'

```

## Creating a broadcasting segment  {#creating-a-broadcasting-segment}

To schedule a streaming segment, use the [Create Channel Stream Schedule Segment](/docs/api/reference#create-channel-stream-schedule-segment) endpoint. The endpoint lets you create recurring and non-recurring segments.

**NOTE**: Only partners and affiliates may create non-recurring segments.

### Recurring segment  {#recurring-segment}

A recurring segment defines a weekly broadcast that’s streamed on the same weekday and at the same time every week.

The request must include:

- A user access token that includes the **channel:manage:schedule** scope.
- The broadcaster_id query parameter that’s set to the ID of the broadcaster who wants to add the weekly segment.
- An object in the request body with the following fields:

- The `start_time` field that’s set to the day and time when the broadcaster wants to broadcast. The date determines the day of the week that the broadcast falls on. If the date is set to 2 September at 10:00 AM, the broadcaster’s weekly segment occurs on Fridays at 10:00 AM. Segments start on the first weekday on or after today’s date. So, if today is Wednesday, 24 August and you specify a start date of 2 September, the first segment begins 26 August; you cannot schedule a recurring broadcasting schedule that starts in the future.
- The `timezone` field that’s set to the time zone where the broadcaster is located. Specify the time zone using [IANA time zone database](https://www.iana.org/time-zones) format. For example, America/Los_Angeles.
- The `duration` field that’s set to the length of the broadcast in minutes.
- The `is_recurring` field that’s set to **true**.

Although optional, you should also specify:

- The `category_id` field that’s set to the ID of the category or game that identifies the type of content that the broadcaster will stream. For example, if the broadcaster has a talk show, set this parameter to the Just Chatting ID (509658). To discover category or game IDs, use the [Search Categories](/docs/api/reference#search-categories) endpoint.
- The `title` field that’s set to a short description of what the segment will cover.

The following example shows how to create a recurring segment.

```
curl -X POST 'https://api.twitch.tv/helix/schedule/segment?broadcaster_id=123456' \
-H 'Authorization: Bearer nazuiljmvk36jx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uexdkt7uu49jjqm575f' \
-H 'Content-Type: application/json' \
-d '{"start_time":"2022-08-26T07:00:00Z","duration":45,"timezone":"America/Los_Angeles","title":"Emira or Cayman?","is_recurring":true,"category_id":509658}'

```

The following example shows the response if the request succeeds.

```
{
  "data": {
    "segments": [
      {
        "id": "eyJzZWdtZW50SUQiOiI1MDc2NmFlOC1lMmJlLTQzMjYjRkNzkiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjo1MX0=",
        "start_time": "2022-08-26T07:00:00Z",
        "end_time": "2022-08-26T07:45:00Z",
        "title": "Emira or Cayman?",
        "canceled_until": null,
        "category": {
          "id": "509658",
          "name": "Just Chatting"
        },
        "is_recurring": true
      }
    ],
    "broadcaster_id": "123456",
    "broadcaster_name": "zippydodah",
    "broadcaster_login": "ZippyDoDah",
    "vacation": {
      "start_time": "2020-09-01T00:00:00Z",
      "end_time": "2020-09-30T23:59:59Z"
    }
  }
}

```

Scheduling recurring segments that overlap will fail. For example, if a recurring segment occurs on Thursdays from 8:30 AM to 9:30 AM, you may not create another recurring segment on Thursdays that overlaps that time period.

### Non-recurring segment  {#non-recurring-segment}

A non-recurring segment is a one-time broadcast segment. In the Twitch UX, non-recurring segments are shown under **Upcoming Events** in the broadcaster’s schedule.

**NOTE**: Only partners and affiliates may create non-recurring segments.

The only differences between creating recurring and non-recurring segments are:

- The start_time query parameter specifies the actual date and time of the segment, which may be a future date.
- The is_recurring query parameter is set to **false**.

```
curl -X POST 'https://api.twitch.tv/helix/schedule/segment?broadcaster_id=123456' \
-H 'Authorization: Bearer nazuiljmvk36jx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uexdkt7uu49jjqm575f' \
-H 'Content-Type: application/json' \
-d '{"start_time":"2022-09-05T07:00:00Z","duration":45,"timezone":"America/Los_Angeles","title":"Emira First Drive","is_recurring":false,"category_id":509658}'

```

Non-recurring segments may overlap recurring segments, but this might confuse viewers unless you also cancel the recurring segment.

## Updating a broadcasting segment  {#updating-a-broadcasting-segment}

To update a broadcasting segment, use the [Update Channel Stream Schedule Segment](/docs/api/reference#update-channel-stream-schedule-segment) endpoint.

When you create a recurring segment, it applies the same title, duration, etc. to each occurrence in the schedule. If the broadcaster changes their broadcast’s topic weekly, you’d use this endpoint to update the title for the current week’s broadcast. But just like when you create the segment, the title change applies to all of that segment’s occurrences. The same is true for duration and category ID.

To update the segment’s title, the request must include:

- A user access token that includes the **channel:manage:schedule** scope.
- The broadcaster_id query parameter that’s set to the ID of the broadcaster who wants to update the segment.
- The id query parameter that’s set to the ID of the segment to update. To get the ID associated with a specific segment, see Getting the broadcaster’s streaming schedule. Because the update applies to all of the segment’s occurrences, it doesn’t matter which ID you use.
- An object in the body of the request that includes the following fields:

- The `title` field that’s set to the new title.

```
curl -X PATCH 'https://api.twitch.tv/helix/schedule/segment?broadcaster_id=123456&id=eyJzZWdtZW50SUQiOiIxYjY4YzQyOC1kZmJ2NTAyNmIiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozNX0=' \
-H 'Authorization: Bearer nazuiljmm4vkjx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uexdkt7uu49jjqm575f' \
-H 'Content-Type: application/json' \
-d '{"title":"The 2023 GT3 RS is a beast!"}'

```

The ID for the above request is for a future broadcast date but since the change affects all dates in the segment, the response shows the date of the next scheduled segment.

```
{
  "data": {
    "segments": [
      {
        "id": "eyJzZWdtZW50SUQiOiIxYjY4YzQyOC1kZm0zODhjMGQ2NTAyNmIiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozNH0=",
        "start_time": "2022-08-25T22:00:00Z",
        "end_time": "2022-08-25T22:35:00Z",
        "title": "The 2023 GT3 RS is a beast!",
        "canceled_until": null,
        "category": null,
        "is_recurring": true
      }
    ],
    "broadcaster_id": "123456",
    "broadcaster_name": "zippydodah",
    "broadcaster_login": "ZippyDoDah",
    "vacation": {
      "start_time": "2022-10-01T00:00:00Z",
      "end_time": "2023-04-30T23:59:59Z"
    }
  }
}

```

For recurring segments, you may change the segment’s duration but not the start date. Updating the duration changes the duration of all occurrences in that segment.

If you need to change the start time of this week’s broadcast, you could 1) cancel this week’s broadcast, 2) create a new recurring segment with the same information but a new start time, and 3) delete the new recurring segment after the broadcast. Note that the new segment’s start time can’t overlap the original segment’s start time and duration.

For non-recurring segments, you may change the segment’s start time and duration.

**NOTE**: Only partners and affiliates may update a non-recurring segment’s start time and duration.

### Canceling a segment  {#canceling-a-segment}

If the broadcaster is unable to broadcast a segment, you can cancel it by setting the `is_canceled` field to **true**.

For recurring segments, you may cancel only the next scheduled occurrence. If you try to cancel a future occurrence, it cancels the next scheduled segment only. But you may cancel future, non-recurring segments.

The request must include:

- A user access token that includes the **channel:manage:schedule** scope.
- The broadcaster_id query parameter that’s set to the ID of the broadcaster who wants to cancel one of their broadcasting segments.
- The id query parameter that’s set to the ID of the occurrence to cancel. To get the ID associated with an occurrence of a segment, see Getting the broadcaster’s streaming schedule.
- An object in the body of the request that includes the following fields:

- The `is_canceled` field set to **true**.

```
curl -X PATCH 'https://api.twitch.tv/helix/schedule/segment?broadcaster_id=123456&id=eyJzZWdtZW50SUQiOiIxYjY4YzQyOC1kZmJiLTQ2NjkiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozNX0=' \
-H 'Authorization: Bearer nazuimm4vk36jx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z41sa8uekjvt7uu49jjqm575f' \
-H 'Content-Type: application/json' \
-d '{"is_canceled":true}'

```

If the request succeeds, the `canceled_until` field is set to the value in `end_time`.

```
{
  "data": {
    "segments": [
      {
        "id": "eyJzZWdtZW50SUQiOiIxYjY4YzQyOC1kZmJiLTQ2NjkiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozNX0=",
        "start_time": "2022-08-27T19:00:00Z",
        "end_time": "2022-08-27T19:45:00Z",
        "title": "created to test canceling non-recurring segment",
        "canceled_until": "2022-08-27T19:45:00Z",
        "category": {
          "id": "509658",
          "name": "Just Chatting"
        },
        "is_recurring": false
      }
    ],
    "broadcaster_id": "123456",
    "broadcaster_name": "zippydodah",
    "broadcaster_login": "ZippyDoDah",
    "vacation": {
      "start_time": "2022-10-01T00:00:00Z",
      "end_time": "2023-04-30T23:59:59Z"
    }
  }
}

```

## Deleting a broadcasting segment  {#deleting-a-broadcasting-segment}

To delete a broadcasting segment, use the [Delete Channel Stream Schedule Segment](/docs/api/reference#delete-channel-stream-schedule-segment) endpoint.

The request must include:

- A user access token that includes the **channel:manage:schedule** scope.
- The broadcaster_id query parameter that’s set to the ID of the broadcaster who wants to delete one of their broadcasting segments.
- The id query parameter that’s set to the ID of the segment to delete. To get the ID associated with a segment, see Getting the broadcaster’s streaming schedule. For non-recurring segments, the request deletes the specified segment, but for recurring segments, the request deletes the entire recurring segment and not just the occurrence associated with the ID. For example, if you pass the ID of a broadcast that occurs in two weeks, the request deletes the entire recurring segment and not just the broadcast that occurs in two weeks.

```
curl -X DELETE 'https://api.twitch.tv/helix/schedule/segment?broadcaster_id=123456&id=eyJzZWdtZW50SUQiOiIxYjY4YzQyOC1kZmJiLTTAyNmIiLCJpc29ZZWFyIjoyMDIyLCJpc29XZWVrIjozNn0=' \
-H 'Authorization: Bearer nazujmm4vk36jx1l5xhlsnakgrhj' \
-H 'Client-Id: dt4z4a8uexdkjvt7uu49jjqm575f'

```

If the request succeeds, the response is HTTP status code 204 No Content.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
