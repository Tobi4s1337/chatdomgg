<!-- source: https://dev.twitch.tv/docs/api/guide/ -->

Contents

# Twitch API Concepts  {#twitch-api-concepts}

This topic contains concepts that you should be familiar with when working with the Twitch API.

## Breaking changes  {#breaking-changes}

In rare cases it may be necessary to introduce breaking changes to the Twitch API. Twitch will provide as much notification as possible prior to introducing a breaking change; however, there may be times when providing prior notification isn’t possible (for example, to address security or privacy issues).

Twitch uses the **Announcement** section of the [Twitch Developer Forum](https://discuss.dev.twitch.tv/c/announcements/) to provide notification of a pending breaking change. To prevent disruption of your application or service, be sure to update your application as appropriate and in a timely fashion. The notification will identify all programming elements involved in the breaking change and will provide guidance on work-arounds if available.

Some of the reasons why Twitch may introduce a breaking change, include but are not limited to:

- Security issues
- Privacy concerns
- Legal concerns
- A bug that prevents the API from working as intended (for example, adding or updating constraints, adding required parameters without default values, or changing the response data)
- A business change that requires removal of an API or feature of an API such as removing an option to retrieve a single resource instead of the entire list

### Non-breaking changes  {#non-breaking-changes}

Twitch may make the following non-breaking changes without prior notification:

- Add optional query parameters or fields to a request
- Add new values to the list of possible values that you can set the request’s query parameters or fields to
- Add fields to the response (your code should ignore any fields that it doesn’t expect)
- Change the order of the fields in the response
- Add or update error message strings (your code should not take dependencies on message strings)
- Change the path, query parameters, or fragment of a URL that the API returns such as image URLs (your code should not take dependencies on the URLs that the API returns except where noted)

To discover non-breaking changes, review the [change log](/docs/change-log).

### Taking dependencies  {#taking-dependencies}

Your application should not take dependencies on:

- Error message strings
- URLs that the API returns (except where noted)
- The format of strings in the API responses

## Twitch Rate Limits  {#twitch-rate-limits}

To protect Twitch services, and to make sure there are enough resources for all partners, Twitch limits the number of requests a client ID (app) may make. If your app exceeds the limit, the request returns HTTP status code 429 (Too Many Requests).

### How it works  {#how-it-works}

Twitch uses a token-bucket algorithm to ensure the limits are respected. Your app is given a bucket of points. Each endpoint is assigned a points value (the default points value per request for an endpoint is 1). When your app calls the endpoint, the endpoint’s points value is subtracted from the remaining points in your bucket. If your bucket runs out of points within 1 minute, the request returns status code 429.

Your app is given a bucket for app access requests and a bucket for user access requests. For requests that specify a user access token, the limits are applied per client ID per user per minute.

If an endpoint uses a non-default points value, or specifies different limit values, the endpoint’s documentation identifies the differences.

For details about the Extensions API rate limits, see [Extension rate limits](/docs/extensions/frontend-api-usage#rate-limits).

**Note:** Some API endpoints may return HTTP 429 response codes for reasons unrelated to the general rate limit bucket. In these cases, you must parse the error message returned to determine the reason for the response.

### Keeping track of your usage  {#keeping-track-of-your-usage}

The API includes the following headers with each response to help you stay within your request limits.

- `Ratelimit-Limit` — The maximum rate of your bucket.
- `Ratelimit-Remaining` — The number of points in your bucket.
- `Ratelimit-Reset` — A Unix epoch timestamp that identifies when your bucket is reset to full.

An example of these headers:

```
Ratelimit-Limit: 800
Ratelimit-Remaining: 799
Ratelimit-Reset: 1781653392

```

If you receive HTTP status code 429, use the `Ratelimit-Reset` header to learn how long you must wait before making another request.

## Pagination  {#pagination}

The Twitch API supports cursor-based pagination for APIs that return lists of resources.

List APIs like [Get Videos](/docs/api/reference#get-videos) use the following query parameters to control paging:

- after — Use to get the next page of results
- before — Use to get the previous page of results
- first — Use to specify the number of items to include per page

The after and before parameters are mutually exclusive; you may specify only one of them in the request.

If the list API is able to return another page of results, the response includes the `pagination` field, which is a **Pagination** object that includes the `cursor` field.

```
    "pagination": {
      "cursor": "eyJiI..."
    }

```

Use the cursor’s value to set the after or before query parameter depending on the direction you want to page. See Forward pagination and Backward pagination.

The **Pagination** object is empty if there are no more pages to return in the direction you’re paging.

```
    "pagination": {}

```

### Specifying the page size  {#specifying-the-page-size}

List APIs return a default number of items per page. For example, the default page size for [Get Streams](/docs/api/reference#get-streams) is 20 items per page. To specify a different page size, include the first query parameter with each request.

```
curl -X GET 'https://api.twitch.tv/helix/streams?first=40' \
-H 'Authorization: Bearer <access token goes here>' \
-H 'Client-Id: <client id goes here>'

```

The API’s documentation specifies the minimum page size, maximum page size, and default page size. For example, the maximum page size for Get Streams is 100.

An API may return less than the number of items requested per page, which is often the case for the last page of results.

### Forward pagination  {#forward-pagination}

To get the first page, don’t specify the after query parameter.

```
curl -X GET 'https://api.twitch.tv/helix/streams?first=40' \
-H 'Authorization: Bearer <access token goes here>' \
-H 'Client-Id: <client id goes here>'

```

To get the next page, and all subsequent pages, set the after query parameter to the value in the `cursor` field of the response’s **Pagination** object. The cursor marks the top of the next page of results.

```
curl -X GET 'https://api.twitch.tv/helix/streams?first=40&after=eyJiI...' \
-H 'Authorization: Bearer <access token goes here>' \
-H 'Client-Id: <client id goes here>'

```

You’ll know you’re at the end of the list when the response contains an empty **Pagination** object.

### Backward pagination  {#backward-pagination}

Not all APIs support paging backward. Check the documentation to confirm whether the API supports backward pagination — the API supports backward pagination if the list of query parameters includes the before query parameter.

To page backward through a list, set the before query parameter to the value in the `cursor` field of the response’s **Pagination** object. The cursor marks the top of the previous page of results.

```
curl -X GET 'https://api.twitch.tv/helix/streams?first=40&before=eyJiI...' \
-H 'Authorization: Bearer <access token goes here>' \
-H 'Client-Id: <client id goes here>'

```

You’ll know you’re at the beginning of the list when the response contains an empty **Pagination** object. To page forward when you’re at the top of the list, don’t include a cursor parameter.

If you page forward to the end of the list, the **Pagination** object is empty. Because of this, you must keep a copy of the previous cursor to use to page backward.

### Lists are dynamic  {#lists-are-dynamic}

Because lists are dynamic views of the data, it’s possible that the cursor may return an empty page (`"data":[]`) when you’re near the end of the list.

It’s also possible that you might see the same data on multiple pages. For example, [Get Streams](/docs/api/reference#get-streams) orders the list of streamers by the number of viewers they have. If the streamer’s viewership changes between the time you get the cursor and the the time the user pages forward or backward, it’s possible that the streamer could have moved up or down in the list and the user would see them on both pages.

For the same reason, it’s also possible that if the user pages forward and then backward, the contents of the previous page may be partially or fully different depending on how volatile the data is.

### Known issues  {#known-issues}

The following list contains known issues that you should consider when designing your app.

- The [Get EventSub Subscriptions](/docs/api/reference#get-eventsub-subscriptions) endpoint doesn’t let you specify the page size (the first query parameter is not supported).
- The [Get Extension Live Channels](/docs/api/reference#get-extension-live-channels) endpoint doesn’t use the same **Pagination** object as the other endpoints that support paging. Instead, it contains a `pagination` field that contains either an empty string or a cursor value.

## Query Parameters  {#query-parameters}

Things to know about endpoint query parameters and fields.

### IDs are opaque  {#ids-are-opaque}

All IDs are strings and should be considered opaque, meaning its value can be anything. All POST operations that add a resource will return the resource’s ID and all GET operations include the resource’s ID.

### Required versus optional parameters  {#required-versus-optional-parameters}

All required query parameters and fields are marked as required. You should consider all other fields optional.

Some endpoints such as [Get Videos](/docs/api/reference#get-videos) specify required query parameters that are mutually exclusive, meany you may specify only one of the required parameters that are marked as mutually excluisve. The description for these parameters clearly will indicate that they are mutually exclusive.

### Specifying multiple query parameter values  {#specifying-multiple-query-parameter-values}

Some endpoints use query parameters to filter the data. If a query parameter lets you specify a list of values, you must specify the query parameter for each value in the list; the list is not comma delimited. For example, to specify multiple login values, you’d specify them as `&login=twitch&login=twitchdev&login=twitchgaming`.

### Enumeration values  {#enumeration-values}

If a query parameter lists a set of enumeration values, consider the list case sensitive unless stated otherwise.

### Timestamps  {#timestamps}

All date and time query parameters and fields used in the Twitch API are in [RFC3339](https://datatracker.ietf.org/doc/html/rfc3339) format. For example, YYYY-MM-DDT00:00:00.000Z.

**NOTE** The timestamps used in all [EventSub](/docs/eventsub) events are in RFC3339 format; however, the timestamps use nanoseconds instead of milliseconds. For example, YYYY-MM-DDT00:00:00.000000000Z.

### Pagination parameters  {#pagination-parameters}

Some GET endpoints that return lists of resources support pagination. For details, see Pagination.

## cURL Examples  {#curl-examples}

All cURL examples shown throughout the Twitch API documentation use UNIX and Linux format. This means that the examples will not run as-is on Microsoft Windows computers. To run the examples on Windows computers, you must change the continuation marks from `\` to `^` and change the single quotes to double quotes.

A UNIX formatted cURL query:

```
curl -X POST 'https://id.twitch.tv/oauth2/token' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-d 'client_id=<your client id goes here>&client_secret=<your client secret goes here>&grant_type=client_credentials'

```

The equivalent Windows cURL query:

```
curl -X POST "https://id.twitch.tv/oauth2/token" ^
-H "Content-Type: application/x-www-form-urlencoded" ^
-d "client_id=<your client id goes here>&client_secret=<your client secret goes here>&grant_type=client_credentials"

```

## Twitch API Health  {#twitch-api-health}

If you receive an HTTP status code 503 (Service Unavailable) error, retry once. You may also report any issue that appears to be a bug via [GitHub Issues](https://github.com/twitchdev/issues/issues).

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
