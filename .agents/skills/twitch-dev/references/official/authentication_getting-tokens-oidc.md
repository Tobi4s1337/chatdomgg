<!-- source: https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/ -->

Contents

# Using OIDC to get OAuth Access Tokens  {#using-oidc-to-get-oauth-access-tokens}

Twitch supports getting OAuth user access tokens using [OpenID Connect](https://openid.net/connect/). For information about the claims that you can request, see Requesting claims.

To get an OAuth user access token, use one of the following flows:

| Flow | Description |  |
|---|---|---|
| OIDC Implicit grant flow | User access token | Use this flow if your app does not use a server. For example, use this flow if your app is a client-side JavaScript app or mobile app. |
| OIDC Authorization code grant flow | User access token | Use this flow if your app uses a server, can securely store a client secret, and can make server-to-server requests to the Twitch API. |

**NOTE** If you need an app access token, you must use the [client credentials flow](/docs/authentication/getting-tokens-oauth#client-credentials-grant-flow).

## Discovering supported claims and authorization URIs  {#discovering-supported-claims-and-authorization-uris}

To discover the claims that Twitch supports, send an HTTP GET request to `https://id.twitch.tv/oauth2/.well-known/openid-configuration`. The `claims_supported` field contains the list of claims. The response also includes supported response types and URIs that you use for authorization. The discovery information lets you easily integrate with standard OIDC clients like [AWS Cognito](https://aws.amazon.com/cognito/).

The following example shows Twitch’s OIDC configuration.

```
{
  "authorization_endpoint": "https://id.twitch.tv/oauth2/authorize",
  "claims_parameter_supported": true,
  "claims_supported": [
    "email",
    "email_verified",
    "picture",
    "preferred_username",
    "exp",
    "iss",
    "sub",
    "azp",
    "aud",
    "iat",
    "updated_at"
  ],
  "id_token_signing_alg_values_supported": [
    "RS256"
  ],
  "issuer": "https://id.twitch.tv/oauth2",
  "jwks_uri": "https://id.twitch.tv/oauth2/keys",
  "response_types_supported": [
    "id_token",
    "code",
    "token",
    "code id_token",
    "token id_token"
  ],
  "scopes_supported": [
    "openid"
  ],
  "subject_types_supported": [
    "public"
  ],
  "token_endpoint": "https://id.twitch.tv/oauth2/token",
  "token_endpoint_auth_methods_supported": [
    "client_secret_post"
  ],
  "userinfo_endpoint": "https://id.twitch.tv/oauth2/userinfo"
}

```

### How do I use the URIs?  {#how-do-i-use-the-uris}

| URI | Used to… |
|---|---|
| authorization_endpoint | Used to get an access token if you’re using the OIDC Implicit grant flow or an authorization code if you’re using the OIDC Authorization code grant flow. |
| token_endpoint | Used to get an access token if you’re using the OIDC Authorization code grant flow. |
| jwks_uri | Used to validate an ID token. See Validating an ID token. |
| userinfo_endpoint | Used to get claims from an OAuth access token. See Getting claims information from an access token. |

### How do I use the supported claims?  {#how-do-i-use-the-supported-claims}

Used to set the claims parameter, which tells the server which claims to include with the OAuth access token and ID token. See Requesting claims.

### How do I use the response types?  {#how-do-i-use-the-response-types}

Used to set the response_type parameter, which tells the server which types of tokens you want the authorization request to return.

## OIDC implicit grant flow  {#oidc-implicit-grant-flow}

This flow is meant for apps that don’t use a server, such as client-side JavaScript apps or mobile apps.

To get a user access token using the [implicit grant flow](https://datatracker.ietf.org/doc/html/rfc6749#section-1.3.2), navigate a user to `https://id.twitch.tv/oauth2/authorize` with the following query parameters that are appropriate for your application. This can be done via your application control logic or simply by adding an HTML hyperlink for a user to click if your service is a website (e.g. `<a href="https://id.twitch.tv/oauth2/authorize?[parameters]">Connect with Twitch</a>`).

| Parameter | Required? | Type | Description |
|---|---|---|---|
| claims | No | String | A string-encoded JSON object that specifies the claims to include in the ID token. For information about claims, see Requesting claims. |
| client_id | Yes | String | Your app’s [registered](/docs/authentication/register-app) client ID. |
| force_verify | No | Boolean | Set to **true** to force the user to re-authorize your app’s access to their resources. The default is **false**. |
| nonce | No | String | Although optional, you are strongly encouraged to pass a nonce string to help prevent [Cross-Site Request Forgery](https://datatracker.ietf.org/doc/html/rfc6749#section-10.12) (CSRF) attacks. The server returns this string to you in the ID token’s list of claims. If this string doesn’t match the nonce string that you passed, ignore the response. The nonce string should be randomly generated and unique for each OAuth request. Use this parameter if response_type includes `id_token`. |
| redirect_uri | Yes | URI | Your app’s [registered](/docs/authentication/register-app) redirect URI. The access token and ID token are sent to this URI. |
| response_type | Yes | String | Must be set to one of the following possible values:  - token id_token — Returns an access token and an ID token. You must URL encode the type (for example, `token+id_token`). - id_token — Returns only an ID token. You might use this option if you have a valid access token and just want to include information about the authorizing user in the ID token. |
| scope | Yes | String | A space-delimited list of scopes. The APIs that you’re calling identify the scopes you must list. The list must include the **openid** scope if response_type includes `id_token` or you want to include the non-default claims (see Requesting claims). Don’t forget to URL encode the list. |
| state | No | String | Although optional, you are strongly encouraged to pass a state string to help prevent [Cross-Site Request Forgery](https://datatracker.ietf.org/doc/html/rfc6749#section-10.12) (CSRF) attacks. The server returns this string to you in your redirect URI (see the state parameter in the fragment portion of the URI). If this string doesn’t match the state string that you passed, ignore the response. The state string should be randomly generated and unique for each OAuth request. Use this parameter if response_type includes `token`. |

The following URI shows an example of the URI that you’ll navigate to in your web browser control (the URI is formatted for easier reading).

```
https://id.twitch.tv/oauth2/authorize
    ?response_type=token+id_token
    &client_id=hof5gwx0su6owfnys0nyan9c87zr6t
    &redirect_uri=http://localhost:3000
    &scope=channel%3Amanage%3Apolls+channel%3Aread%3Apolls+openid
    &state=c3ab8aa609ea11e793ae92361f002671
    &nonce=c3ab8aa609ea11e793ae92361f002671

```

If the user is logged in, Twitch asks them to authorize your app’s access to the specified resources. If they’re not logged in, Twitch first asks them to log in and then asks them to authorize your app.

If the user authorized your app by clicking **Authorize**, the server sends the access token and ID token to your redirect URI **in the fragment portion** of the URI (see the access_token and id_token parameters). Remember, the nonce is in the claims portion of the ID token’s payload.

```
http://localhost:3000/
    #access_token=73gl5dipwta5fsfma3ia05woyffbp
    &id_token=eyJhbGciOiJSUzI1NiIsInR5cC6IkpXVCIsImtpZCI6IjEifQ...
    &scope=channel%253Amanage%253Apolls+channel%253Aread%253Apolls+openid
    &state=c3ab8aa609ea11e793ae92361f002671
    &token_type=bearer

```

**NOTE** In JavaScript, you can access the fragment using `document.location.hash`.

If the user didn’t authorize your app, the server sends the error code and description to your redirect URI (see the error and error_description query parameters).

```
http://localhost:3000/
    ?error=access_denied
    &error_description=The+user+denied+you+access
    &state=c3ab8aa609ea11e793ae92361f002671

```

For information about the claims that your tokens include by default, see Requesting claims.

For information about validating the ID token, see Validating an ID token.

## OIDC authorization code grant flow  {#oidc-authorization-code-grant-flow}

This flow is meant for apps that use a server, can securely store a client secret, and can make server-to-server requests to the Twitch API. To get a user access token using the [authorization code grant flow](https://datatracker.ietf.org/doc/html/rfc6749#section-1.3.1), your app performs the following steps:

### Get the user to authorize your app  {#get-the-user-to-authorize-your-app}

The first step is to get the user to authorize your app’s access to their resources. To get the authorization, in your web browser control, navigate to `https://id.twitch.tv/oauth2/authorize`. Set the following query parameters as appropriate for your app.

| Parameter | Required? | Type | Description |
|---|---|---|---|
| claims | No | String | A string-encoded JSON object that specifies the claims to include in the ID token. For information about claims, see Requesting claims. |
| client_id | Yes | String | Your app’s [registered](/docs/authentication/register-app) client ID. |
| force_verify | No | Boolean | Set to **true** to force the user to re-authorize your app’s access to their resources. The default is **false**. |
| nonce | No | String | Although optional, you are strongly encouraged to pass a nonce string to help prevent [Cross-Site Request Forgery](https://datatracker.ietf.org/doc/html/rfc6749#section-10.12) (CSRF) attacks. The server returns this string to you in the ID token’s list of claims. If this string doesn’t match the nonce string that you passed, ignore the response. The nonce string should be randomly generated and unique for each OAuth request. |
| redirect_uri | Yes | URI | Your app’s [registered](/docs/authentication/register-app) redirect URI. The authorization code is sent to this URI. |
| response_type | Yes | String | Must be set to `code`. |
| scope | Yes | String | A space-delimited list of scopes. The APIs that you’re calling identify the scopes you must list. The list must include the **openid** scope. Don’t forget to URL encode the list. |
| state | No | String | Although optional, you are strongly encouraged to pass a state string to help prevent [Cross-Site Request Forgery](https://datatracker.ietf.org/doc/html/rfc6749#section-10.12) (CSRF) attacks. The server returns this string to you in your redirect URI (see the state parameter in the fragment portion of the URI). If this string doesn’t match the state string that you passed, ignore the response. The state string should be randomly generated and unique for each OAuth request. |

The following URI shows an example request that you’ll navigate to in your web browser control (the URI is formatted for easier reading).

```
https://id.twitch.tv/oauth2/authorize
    ?response_type=code
    &client_id=hof5gwx0su6owfnys0nyan9c87zr6t
    &redirect_uri=http://localhost:3000
    &scope=channel%3Amanage%3Apolls+channel%3Aread%3Apolls+openid
    &state=c3ab8aa609ea11e793ae92361f002671
    &nonce=c3ab8aa609ea11e793ae92361f002671

```

If the user is logged in, Twitch asks them to authorize your app’s access to the specified resources. If they’re not logged in, Twitch first asks them to log in and then asks them to authorize your app.

If the user authorized your app by clicking **Authorize**, the server sends the authorization code to your redirect URI (see the code query parameter):

```
http://localhost:3000/
    ?code=gulfwdmys5lsm6qyz4ximz9q32l10
    &scope=channel%3Amanage%3Apolls+channel%3Aread%3Apolls+openid
    &state=c3ab8aa609ea11e793ae92361f002671

```

If the user didn’t authorize your app, the server sends the error code and description to your redirect URI (see the error and error_description query parameters):

```
http://localhost:3000/
    ?error=access_denied
    &error_description=The+user+denied+you+access
    &state=c3ab8aa609ea11e793ae92361f002671

```

### Use the authorization code to get a token  {#use-the-authorization-code-to-get-a-token}

The second step is to use the authorization code (see above) to get an access token, refresh token, and ID token.

To get the tokens, send an HTTP POST request to `https://id.twitch.tv/oauth2/token`. Set the following x-www-form-urlencoded parameters in the body of the POST.

| Parameter | Required? | Type | Description |
|---|---|---|---|
| client_id | Yes | String | Your app’s [registered](/docs/authentication/register-app) client ID. |
| client_secret | Yes | String | Your app’s registered client secret. |
| code | Yes | String | The code that the `/authorize` response returned in the code query parameter. |
| grant_type | Yes | String | Must be set to `authorization_code`. |
| redirect_uri | Yes | URI | Your app’s registered redirect URI. |

The following example shows the parameters in the body of the POST (the parameters are formatted for easier reading).

```
client_id=hof5gwx0su6owfnys0nyan9c87zr6t
&client_secret=41vpdji4e9gif429md0ouet6fktd2
&code=gulfwdmys5lsm6qyz4ximz9q32l10
&grant_type=authorization_code
&redirect_uri=http://localhost:3000

```

If the request succeeds, it returns an access token, refresh token, and ID token.

```
{
  "access_token": "rfx2uswqe8lu4g1mkagrvg5tv0ks3",
  "expires_in": 14124,
  "id_token":"eyJhbGciOiJSUzI1...",
  "refresh_token": "5b93chm63hdve3mycz05zfzatkfdenfspp1h1ar2xxdalen01",
  "scope": [
    "channel:moderate",
    "chat:edit",
    "chat:read"
  ],
  "token_type": "bearer"
}

```

When the access token expires, use the refresh token to get a new access token. For information about using the refresh token, see [Refreshing Access Tokens](/docs/authentication/refresh-tokens).

For information about the claims that your tokens include by default, see Requesting claims.

For information about validating the ID token, see Validating an ID token.

## Requesting claims  {#requesting-claims}

Claims identify information about the user that authorized your app. The following list identifies the claims that your access token and ID token include by default.

| Claim | Data |
|---|---|
| aud | The client ID of the application that requested the user’s authorization. |
| azp | The client ID of the application that received the user’s authorization. This contains the same value as `aud`. |
| exp | The UNIX timestamp of when the token expires. |
| iat | The UNIX timestamp of when the server issued the token. |
| iss | The URI of the issuing authority. |
| sub | The ID of the user that authorized the app. |

**NOTE** If your authorization request specifies the nonce query parameter, the ID token’s payload also includes the `nonce` claim.

The following list contains the claims that you can also request.

| Claim | Data |
|---|---|
| email | The email address of the user that authorized the app. **Note:** If `email_verified` is **false**, then this field will return **null** |
| email_verified | A Boolean value that indicates whether Twitch has verified the user’s email address. Is **true** if Twitch has verified the user’s email address. |
| picture | A URL to the user’s profile image if they included one; otherwise, a default image. |
| preferred_username | The user’s display name. |
| updated_at | The date and time that the user last updated their profile. |

To include the non-default claims, include the claims query parameter in your `/authorize` request. Set the claims query parameter to a string-encoded JSON object. The JSON object may contain the `id_token` and `userinfo` fields. Set `id_token` field to an object that specifies the claims that you want to include in the ID token, and set the `userinfo` field to an object that specifies the claims that you want to retrieve using the UserInfo endpoint. Each claim is a name/value pair, where name is the claim (e.g., email) and value is **null**.

You may specify the claims in the `id_token`field or the `userinfo` field or both fields. There are no uniqueness constraints — you may specify the same claim in both fields. The following claims object tells the server to include the user’s email and email verification state in the ID token and make the user’s profile image available through the UserInfo endpoint.

```
{
  "id_token": {
    "email": null,
    "email_verified": null
  },
  "userinfo": {
    "picture": null
  }
}

```

The following example shows the claims query parameter set to the above claims object.

`claims={"id_token":{"email":null,"email_verified":null},"userinfo":{"picture":null}}`

**NOTE** If you specify the `email` or `email_verified` claims, you must include the **user:read:email** scope in your list of scopes.

## Getting claims information from an access token  {#getting-claims-information-from-an-access-token}

To get the claims information from an access token, send an HTTP GET request to the `/userinfo` endpoint. You may call this endpoint only with an OAuth access token; you may not call it using an ID token.

```
curl -X GET 'https://id.twitch.tv/oauth2/userinfo' \
-H 'Content-Type: application/json'
-H 'Authorization: Bearer o8cf726oyya7xu47y99a68pv5ih6c'

```

The response is a JSON object that contains the default claims and any non-default claims that you specified in the authorization request.

```
{
  "aud": "hof5gwx0su6owfnys0nyan9c87zr6t",
  "exp": 1644342250,
  "iat": 1644341350,
  "iss": "https://id.twitch.tv/oauth2",
  "sub": "12345678",
  "email": "foo@justin.tv",
  "email_verified": true,
  "picture": "https://static-cdn.jtvnw.net/user-default-pictures-uv/998f01ae-def8-11e9-b95c-784f43822e80-profile_image-150x150.png",
  "updated_at": "2022-02-03T16:16:16.968509Z"
}

```

## Validating an ID token  {#validating-an-id-token}

Validating the ID token is an important security measure to ensure the authenticity of the token and guard against tampering.

To verify an ID token’s signature, you need the following pieces of information.

- The issuer. For example, `https://id.twitch.tv/oauth2`. The token’s payload includes the issuer in `iss` claim.
- The app’s client ID. The token’s payload includes the client ID in the `aud` claim.
- The signing algorithm that Twitch uses to create its JSON Web Key (JWK). For example, RS256. To get this information, call Twitch’s discovery endpoint. The response’s `id_token_signing_alg_values_supported` field identifies the algorithm.
- Twitch’s public JWK. For example, `https://id.twitch.tv/oauth2/keys`. To get the URI to Twitch’s JWK, call Twitch’s discovering endpoint. The response’s `jwks_uri` field identifies the URI.

For more details and an example that shows how to use this information to validate ID tokens, see [How to validate an OpenID Connect ID token](https://connect2id.com/blog/how-to-validate-an-openid-connect-id-token).

## Examples of the two flows  {#examples-of-the-two-flows}

If you don’t want to write code to test the OIDC flows in this topic, try the following options. Before continuing, you’ll need to [register an app](/docs/authentication/register-app) to get a client ID and secret that you can use below. When registering your app, use `http://localhost:3000` for your redirect URI.

### Implicit flow example  {#implicit-flow-example}

Open your favorite browser and enter the following URI in the address bar. Substitute your client ID for the placeholder string.

```
https://id.twitch.tv/oauth2/authorize?response_type=token+id_token&client_id=<your client id goes here>&redirect_uri=http://localhost:3000&scope=channel%3Amanage%3Apolls+channel%3Aread%3Apolls+openid+user%3Aread%3Aemail&claims={"id_token":{"email":null,"email_verified":null},"userinfo":{"email":null,"email_verified":null,"picture":null,"updated_at":null}}&state=c3ab8aa609ea11e793ae92361f002671&nonce=c3ab8aa609ea11e793ae92361f002671

```

If you’re not already signed into your Twitch account, you’ll be asked to sign in. If this client ID hasn’t previously requested access to your Poll resource, you’ll be asked to give consent. If you want to always force consent, include the force_verify query parameter.

If you gave consent, the address bar is set to your redirect URI and it contains the access token and ID token (see the access_token and id_token parameters in the URI’s fragment).

```
http://localhost:3000/#access_token=zvpmzpt4mz5hceho6pgf1m9erzm1e&id_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkXVCIsImtpZCI6IjEifQ.eyJhdWQiOiJob2Y1Z3d4MHN1Nm93Zm55czBueWFuOWM4N3pyNnQiLCJleHAiOjE2NDQ1MTY4MjQsImlhdCI6MTY0NDUxNTkyNCwiaXNzIjoiaHR0cHM6Ly9pZC50d2l0Y2gudHYvb2F1dGgyIiwic3ViIjoiNzEzOTM2NzMzIiwiYXRfaGFzaCI6Inc0dHl0eEg3N0piYXpkVzBka2d4UGciLCJlbWFpbCI6InNjb3R3aHRAanVzdGluLnR2IiwiZW1haWxfdmVyaWZpZWQiOnRydWV9.S2V1ZPILEoHUYw3uQtyl_PoPDuAB6z4KjrfXwtAJtKKKOTBsQQIlLIyGVZHqeYmYNW4EG9GTdoopP4RUb_2ETGAoMbQCZsjRnqYI8SAu58yChxRR0iI7tbbC-7j4d2KPGmdSG651uWQHCtRHd1fBfxCrFuaiwH_PoPkI6YQUB6-moscqr7hpHM_3SSP4Nzts9OeSIS52FawcMbeLXKROZDj7MhsktwVhNaQBAdNRJjqeUEL_V6RF_VhxY8iZbv73YJxfcA7O-fjHzEy00Lq7y-pjd_5TSLvkdheNUCdtKEI4tA_9IZzqrOtmy20pGKF4ovKy-HtASH_qEvswmMxD7A&scope=channel%253Amanage%253Apolls+channel%253Aread%253Apolls+openid+user%253Aread%253Aemail&state=c3ab8aa609ea11e793ae92361f002671&token_type=bearer

```

### Authorization code flow example  {#authorization-code-flow-example}

Open your favorite browser and enter the following URI in the address bar. Substitute your client ID for the placeholder string.

```
https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=<your client id goes here>&redirect_uri=http://localhost:3000&scope=channel%3Amanage%3Apolls+channel%3Aread%3Apolls+openid+user%3Aread%3Aemail&claims={"id_token":{"email":null,"email_verified":null},"userinfo":{"email":null,"email_verified":null,"picture":null,"updated_at":null}}&state=c3ab8aa609ea11e793ae92361f002671&nonce=c3ab8aa609ea11e793ae92361f002671

```

If you’re not already signed into your Twitch account, you’ll be asked to sign in. If this client ID hasn’t previously requested access to your Poll resource, you’ll be asked to give consent. If you want to always force consent, include the force_verify query parameter.

If you gave consent, the address bar is set to your redirect URI and it contains the authorization code.

```
http://localhost:3000/#code=88va56epq1t98c4km4lune8l4alzv&scope=channel%253Amanage%253Apolls+channel%253Aread%253Apolls+openid+user%253Aread%253Aemail&state=c3ab8aa609ea11e793ae92361f002671

```

Open a terminal window and enter the following cURL POST command (you’ll need [cURL installed](https://curl.se/download.html) on your computer). Replace the placeholder strings and the authorization code with your values.

```
curl -X POST 'https://id.twitch.tv/oauth2/token' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-d 'client_id=<your client id goes here>&client_secret=<your client secret goes here>&code=88va56epq1t98c4km4lune8l4alzv&grant_type=authorization_code&redirect_uri=http://localhost:3000'

```

The response contains a JSON object with the access token, refresh token, and ID token.

```
{
  "access_token": "ndwul0n9x8g6257uaei2pyczh22fz",
  "expires_in": 14442,
  "id_token": "eyJhbGciOiJSUzI1NisInR5cCI6IkpXVCIsImtpZCI6IjEifQ.eyJhdWQiOiJob2Y1Z3d4MHN1Nm93Zm55czBueWFuOWM4N3pyNnQiLCJleHAiOjE2NDQ1MTg2NTEsImlhdCI6MTY0NDUxNzc1MSwiaXNzIjoiaHR0cHM6Ly9pZC50d2l0Y2gudHYvb2F1dGgyIiwic3ViIjoiNzEzOTM2NzMzIiwiZW1haWwiOiJzY290d2h0QGp1c3Rpbi50diIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlfQ.uMGOyvmiXHbdUAuQ4j5oExRIO3PyrM7fbhSkbT8r1tIQi5DKlS705oRiQOUGz2_j4yUWIx4zlvYWDbgLWpYS2VtSuXXBb2GbmnCR2kG2PKxbfnY9j4F2RkQfwhYnlz0PToxpoqm_NMEIX3ROzaKs6ixgNQyDRkLS8ik39rEoAy1pEAVwbEj7-NrOYKfvm_W-RCt0Q1ppqHqhSY94jIJ38dYiT47d84c36bY5WBTs7hZniP9vIyDqFel6WO5zWOCCa-qCRS7NMc6TZNVU-2VLTQFL0ABoLSP-E6Y_i4KTp-6NyWHUBXJYoMJekrIQW8_zM-ptskn53--3HMtKCKuhiA",
  "refresh_token": "fi02f7fs1nbpsddfvb709r07y2xbonrk4w7zxjx5woutm568e",
  "scope": [
    "channel:manage:polls",
    "channel:read:polls",
    "openid",
    "user:read:email"
  ],
  "token_type": "bearer"
}

```

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
