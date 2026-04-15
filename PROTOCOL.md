# ws-wrapper Protocol

All data passed over the native WebSocket should be valid JSON, but this is not
a hard requirement. [ws-wrapper](https://github.com/bminer/ws-wrapper/) will try
to parse a JSON string and determine the message type based on the properties in
the parsed Object.

The following message types are defined by ws-wrapper:

1. **Event Dispatch** - Identified by an Object with `a` key but no `i` key. The
   channel name is optional.

   ```javascript
   {
    "c": "channel_name",
    "a": ["event_name", "first_arg", "second_arg", "last_arg"]
   }
   ```

   The client or server can send events. Events are nothing more than an event
   name and some data, passed as arguments to the event handler.

1. **Request** - Identified by an Object with `a` and `i` keys where `i` refers
   to the unique request identifier. The channel name is optional.

   ```javascript
   {
    "i": 123,
    "c": "channel_name",
    "a": ["event_name", "first_arg", "second_arg", "last_arg"]
   }
   ```

   The client or server can send a Request, which is essentially an Event that
   needs some sort of server Response.

1. **Response (Resolution)** - Identified by an Object with `i` and `d` keys
   where `i` is the request identifier and `d` is the response data.

   ```javascript
   {
    "i": 123,
    "d": {"resolved": "data", "hello": "world"}
   }
   ```

1. **Response (Rejection)** - Identified by an Object with `i` and `e` keys
   where `i` is the request identifier and `e` is the rejected value. If `_` is
   set, `e` is an encoded Error object (with at least a `message` key) that is
   reconstructed as an `Error` instance upon receipt. `null` and `undefined`
   rejection values are replaced with a default `Error` object. All other values
   for `e` (strings, numbers, plain objects, etc.) are passed through as-is.

   ```javascript
   // Error instance (e.g. throw new Error("oops"))
   { "i": 123, "e": {"message": "oops"}, "_": 1 }

   // Any other thrown value (e.g. throw "oops" or throw {code: 42})
   { "i": 123, "e": "oops" }
   ```

1. **Request Cancellation** - Identified by an Object with `i` and `x` keys
   where `i` is the request identifier to cancel and `x` is the cancellation
   reason. The same rules as `e` apply: if `_` is set, `x` is an encoded Error
   object, and if the reason is nullish, a default Error is sent. Introduced in
   ws-wrapper v4.

   ```javascript
   // Default (no reason provided)
   { "i": 123, "x": {"message": "Request aborted"}, "_": 1 }

   // String reason
   { "i": 123, "x": "user cancelled" }
   ```

   When a request is cancelled using an `AbortSignal`, a cancellation message is
   sent to the remote end. The `AbortSignal.reason` is forwarded as `x` (with
   `_: 1` when it is an Error instance). `null` and `undefined` reasons are
   replaced with a default `RequestAbortedError` (same rule as for `e`). All
   other reason values are sent exactly as-is. The remote end can use this
   information to stop processing the request and clean up any resources. Event
   handlers on the remote end can access the `AbortSignal` via `this.signal` to
   implement cooperative cancellation.

1. **Anonymous Channel Creation** - Identified by an Object with `i` and `h`
   keys where `h` is truthy. Sent by the handler's side in response to a request
   when the handler returns an anonymous channel via `this.channel()`. The
   channel ID is inferred from `i` (the original request ID).

   ```javascript
   { "i": 123, "h": 1 }
   ```

1. **Anonymous Channel Event** - Like a named-channel event but uses `h` instead
   of `c`. The `h` value is the channel ID (a string matching the original
   request ID).

   ```javascript
   { "h": "123", "a": ["event_name", "arg1", "arg2"] }
   ```

1. **Anonymous Channel Request** - Like a named-channel request but uses `h`
   instead of `c`.

   ```javascript
   { "i": 456, "h": "123", "a": ["event_name", "arg1"] }
   ```

   Responses to requests made on anonymous channels use the standard
   **Response** format (`{i, d}` or `{i, e}`); no `h` field is needed in the
   response.

1. **Anonymous Channel Abort** - Identified by an Object with `h` and `x` keys.
   Can be sent by **either** side to abort the anonymous channel identified by
   `h`. The same encoding rules for `x` and `_` apply as for **Request
   Cancellation** above. Receiving this message closes the local anonymous
   channel (via `chan.close()`).

   ```javascript
   // Error abort (e.g. chan.abort(new Error("done")))
   { "h": "123", "x": {"message": "done"}, "_": 1 }

   // Default abort (e.g. chan.abort())
   { "h": "123", "x": {"message": "Request aborted"}, "_": 1 }
   ```

If the message received by the WebSocket is not valid JSON or if the parsed
Object does not match one of the above message types, then the message is simply
ignored by ws-wrapper. Also if the JSON message contains a `ws-wrapper` property
with the value `false`, the message will be ignored. This allows other libraries
to use the same WebSocket and send messages that will not be processed by
ws-wrapper.
