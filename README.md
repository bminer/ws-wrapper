# ws-wrapper

Lightweight and isomorphic [Web Socket](https://en.wikipedia.org/wiki/WebSocket)
lib with socket.io-like event handling, Promise-based requests, channels, and
cancellation signals.

## What?

Much like Socket.io, this library provides a protocol and API that sits on top
of native WebSockets. Rather than passing raw messages through the WebSocket via
[`WebSocket.send()`](<https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#send()>),
this library provides an RPC-like API that allows you to pass JSON data over
WebSockets and trigger event handlers on the remote end. There is also a
Promise-based request/response API, as well.

This library is isomorphic, so it can wrap WebSockets on the client (i.e.
browser) or on a Node.js server using the [ws](https://github.com/websockets/ws)
library. You can get even fancier on the server side and utilize the
[ws-server-wrapper](https://github.com/bminer/ws-server-wrapper) library
(**recommended**).

## Why?

Because lightweight is sometimes what you want. This library and its
dependencies weigh under 12 KB minified (under 4 KB minified and gzipped)!

This lib might be useful if you want some [socket.io](https://socket.io/docs/)
functionality (i.e. namespaces, event handling, etc.), but you don't want all of
the [engine.io](https://github.com/socketio/engine.io) transports. When using
this library in conjunction with a library like
[ws](https://github.com/websockets/ws), your real-time web application can be
pretty darn lightweight without giving up some nice bare-bones functionality.

## Install

```
npm install ws-wrapper
```

## Usage

WebSocketWrapper is an ES module, so it works in Node.js and in the browser if
you use a bundler like Browserify, Webpack, or Parcel.js.

Check out the
[example-app](https://github.com/bminer/ws-wrapper/tree/master/example-app) for
a sample chat application (**recommended**).

Note: This module uses ES6 classes and ES modules. If you need this to work in
older browsers, try using a code transpiler like [Babel](https://babeljs.io/).

Note: This module uses `JSON.stringify` to serialize data over the raw WebSocket
connection. This means that serializing circular references is not supported out
of the box.

#### Client-side

```javascript
// Use a bundler to make the next line of code "work" on the browser
import WebSocketWrapper from "ws-wrapper"
// Create a new socket
var socket = new WebSocketWrapper(new WebSocket("ws://" + location.hostname))
// Now use the WebSocketWrapper API... `socket.emit` for example
// See examples below...
```

#### Server-side (Node.js)

Use [ws-server-wrapper](https://github.com/bminer/ws-server-wrapper) to wrap the
WebSocketServer (**recommended**). See ws-server-wrapper README for more
details.

If you don't want to use ws-server-wrapper, you can wrap the WebSocket once a
new WebSocket connects like this:

```javascript
import { WebSocketServer } from "ws"
import WebSocketWrapper from "ws-wrapper"
var wss = new WebSocketServer({ port: 3000 })
wss.on("connection", (socket) => {
  socket = new WebSocketWrapper(socket)
  // ...
})
```

#### Server-side (Go)

Use [ws-server-wrapper-go](https://github.com/bminer/ws-server-wrapper-go) to
wrap your favorite WebSocket library. See
[here for a complete example](https://pkg.go.dev/github.com/bminer/ws-server-wrapper-go@v0.0.0-20250119025659-ed3a0d67b7c5/adapters/coder#example-package)
using the [coder/websocket](https://github.com/coder/websocket) library.

#### Other servers

No such libraries exist yet. :( Please create one, and let me know about it!
I'll give you beer!

## Event Handling

It's what you'd expect of an event handler API.

Call `on` or `once` to bind an event handler to the `wrapper` or to a channel.
Call `emit` to send an event.

Server-side Example (_without using ws-server-wrapper_):

```javascript
import { WebSocketServer } from "ws"
import WebSocketWrapper from "ws-wrapper"
var wss = new WebSocketServer({ port: 3000 })
var sockets = new Set()
wss.on("connection", (socket) => {
  var socket = new WebSocketWrapper(socket)
  sockets.add(socket)
  socket.on("msg", function (from, msg) {
    // `this` refers to the WebSocketWrapper instance
    console.log(`Received message from ${from}: ${msg}`)
    // Relay message to all clients
    sockets.forEach((socket) => {
      socket.emit("msg", from, msg)
    })
  })
  socket.on("disconnect", () => {
    sockets.delete(socket)
  })
})
```

Client-side Example:

```javascript
// Use a bundler to make the next line of code "work" on the browser
import WebSocketWrapper from "ws-wrapper"
// Establish connection
var socket = new WebSocketWrapper(new WebSocket("ws://" + location.host))
// Add "msg" event handler
socket.on("msg", function (from, msg) {
  console.log(`Received message from ${from}: ${msg}`)
})
// Emit "msg" event
socket.emit("msg", "my_name", "This is a test message")
```

## Channels

Just like in socket.io, you can "namespace" your events using channels. When
sending messages to multiple channels, the same WebSocket connection is reused,
but the events are logically separated into their appropriate channels.

By default, calling `emit` directly on a WebSocketWrapper instance will send the
message over the "default" channel. To send a message over a channel named
"foo", just call `socket.of("foo").emit("eventName", "yourData")`.

## Request / Response

Event handlers can return values or
[Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
to respond to requests. The response is sent back to the remote end.

The example below shows the client requesting data from the server, but
ws-wrapper also allows servers to request data from the client.

Server-side Example (_without using ws-server-wrapper_):

```javascript
import fs from "node:fs"
import { WebSocketServer } from "ws"
import WebSocketWrapper from "ws-wrapper"
var wss = new WebSocketServer({ port: 3000 })
var sockets = new Set()
wss.on("connection", (socket) => {
  socket = new WebSocketWrapper(socket)
  sockets.add(socket)
  socket.on("userCount", () => {
    // Return value is sent back to the client
    return sockets.size
  })
  socket.on("readFile", (path) => {
    // We can return a Promise that eventually resolves
    return new Promise((resolve, reject) => {
      // `path` should obviously be sanitized, but just go with it...
      fs.readFile(path, (err, data) => {
        // `err` or `data` are now sent back to the client
        if (err) reject(err)
        else resolve(data.toString("utf8"))
      })
    })
  })
  socket.on("disconnect", () => {
    sockets.delete(socket)
  })
})
```

Client-side Example:

```javascript
// Assuming WebSocketWrapper is somehow available to this scope...
var socket = new WebSocketWrapper(new WebSocket("ws://" + location.host))
var p = socket.request("userCount")
// `p` is a Promise that will resolve when the server responds...
p.then((count) => {
  console.log("User count: " + count)
}).catch((err) => {
  console.error("An error occurred while getting the user count:", err)
})
socket
  .request("readFile", "/etc/issue")
  .then((data) => {
    console.log("File contents:", data)
  })
  .catch((err) => {
    console.error("Error reading file:", err)
  })
```

## API

Class: WebSocketWrapper

A WebSocketWrapper simply wraps around a WebSocket to give you well-deserved
functionality. :)

`socket = new WebSocketWrapper(webSocketInstance[, options]);`

Constructs a new WebSocketWrapper, and binds it to the native WebSocket
instance.

- `webSocketInstance` - the native WebSocket instance
- `options`
  - `debug` - set to `true` to print debugging messages to `console.log`
  - `errorToJSON` - function to serialize Errors over the WebSocket. In Node.js,
    the default is to send only the `message` property of the Error (for
    security reasons). Errors that occur on the browser include all properties.
  - `requestTimeout` - maximum delay in ms. that the WebSocketWrapper will wait
    until rejecting the Promise of a pending request. Defaults to `null`, which
    means that there will be no timeout. This option is recommended for servers
    because clients who do not fulfill pending requests can cause memory leaks.
    As of version 4, we send cancellation messages to the remote end for
    requests that time out.

Events

- Event: "open" / "connect"
  - `event` - The (worthless) event from the native WebSocket instance
- Event: "error"
  - `event` - The Error event from the native WebSocket instance
- Event: "message"
  - `event` - The
    [Message event](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent)
    from the native WebSocket instance
  - `data` - The message data (same as `event.data`)
- Event: "close" / "disconnect"
  - `event` - The
    [Close event](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent)
    from the native WebSocket instance
  - `wasOpen` - `true` if the "open" event was fired on the native WebSocket
    instance before the "close" event was fired.

_Note: The "special" events listed above are not sent over the WebSocket._

The EventEmitter-like API looks like this:

- `socket.on(eventName, listener)` Adds the `listener` function to the end of
  the listeners array for the event named `eventName`. When an event or request
  matching the `eventName` is received by the WebSocket, the `listener` is
  called.

  Values returned by the `listener` callback are used to respond to requests
  (see `socket.request`). If the return value of the `listener` is a `Promise`,
  the response to the request will be sent once the Promise is resolved or
  rejected; otherwise, the return value of the `listener` is sent back to the
  remote end immediately.

  If the inbound message is a simple event (see `socket.emit`), the return value
  of the `listener` is ignored. It is also "safe" for the `listener` to return a
  `Promise` even if the inbound message is a "simple" event. If the returned
  `Promise` is rejected, an unhandled rejection will not occur; rather, the
  result of the Promise is just ignored.

  If the `listener` throws an Error, this Error will propagate up the stack as
  expected, and if the inbound message was a request, the Error is sent back to
  the remote end as a response rejection.

- `socket.once(eventName, listener)` Adds a one time `listener` function for the
  event named `eventName`.
- `socket.removeListener(eventName, listener)` Removes the specified `listener`
  from the listener array for the event named `eventName`.
- `socket.removeAllListeners([eventName])` Removes all listeners, or those of
  the specified `eventName`.
- `socket.eventNames()` Returns an array listing the events for which the
  emitter has registered listeners.
- `socket.listeners(eventName)` Returns a copy of the array of listeners for the
  event named `eventName`.
- `socket.emit(eventName[, ...args])` Sends an event down the WebSocket with the
  specified `eventName` calling all listeners for `eventName` on the remote end,
  in the order they were registered, passing the supplied arguments to each.
- `socket.request(eventName[, ...args])` Sends a request down the WebSocket with
  the specified `eventName` and returns a
  [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
  that will resolve once the remote event listener responds.

  **Note**: While it is common design for only one event listener to exist on
  the remote end, all listeners for `eventName` on the remote end are called, in
  the order they were registered, passing the supplied arguments to each. Since
  Promises can only be resolved or rejected once, only the data from the first
  event listener is used to generate the response for this request.

  **Note**: If a request is sent, but there is no remote event listener to
  respond to the request, a response rejection is immediately sent back by the
  remote end.

- `socket.use(function fn(eventName, args, next) {...})` Adds a middleware
  function `fn` to receive all messages for the channel. The `eventName`
  indicates the name of the event or request, and the `args` are the arguments
  to be passed to the respective event handler. `next([err])` should be called
  to continue processing to the next middleware function. Once all middleware
  have processed the event and called `next`, the event is then processed by the
  event handler for the `eventName`.
- `socket.timeout(tempTimeoutInMs)` Temporarily sets the `requestTimeout` to
  `tempTimeoutInMs` for the next request only. This returns `socket` to allow
  chaining. Typical usage:

  ```javascript
  // The next request will be rejected if there is no response for 5 secs.
  let promise = socket.timeout(5 * 1000).request("readFile", "/etc/issue")
  ```

- `socket.signal(abortSignal)` Temporarily sets the `AbortSignal` for the next
  request only. This allows cancellation of in-flight requests. This returns
  `socket` to allow chaining. Can be combined with `timeout()`. Typical usage:

  ```javascript
  const controller = new AbortController()

  // The next request can be cancelled using the AbortController
  let promise = socket.signal(controller.signal).request("longOperation", data)

  // Later, we can cancel the request. In this case, our Promise will be
  // immediately rejected with RequestAbortedError, and the remote end will
  // receive a cancellation message.
  controller.abort()

  // Combined with timeout
  let promise2 = socket
    .timeout(10000)
    .signal(controller.signal)
    .request("heavyTask", data)
  ```

The above EventEmitter functions like `on` and `once` are chainable (as
appropriate).

Channel API:

- `socket.of(channelName)` Returns the channel with the specified `channelName`.
  Every channel has the same EventEmitter-like API as described above for
  sending and handling channel-specific events and requests. A channel also has
  a read-only `name` property.

Other methods and properties:

By default, the WebSocketWrapper provides a queue for data to be sent. Once the
WebSocket is open, this queue is flushed until the connection is lost. The
following methods allow one to re-bind a new WebSocket or clear the send queue.

- `socket.abort()` Clears the send queue for this WebSocketWrapper and rejects
  all Promises for pending requests.
- `socket.bind(nativeWebSocket)` Binds this WebSocketWrapper to a new WebSocket.
  This can be useful when socket reconnection logic needs to be implemented.
  Instead of creating a new WebSocketWrapper each time a WebSocket is
  disconnected, one can simply bind a new WebSocket to the WebSocketWrapper. In
  this way, data queued to be sent while the connection was dead will be sent
  over the new WebSocket passed to the `bind` function.
- `socket.isConnecting` - checks the native WebSocket `readyState` and is `true`
  if and only if the state is CONNECTING.
- `socket.isConnected` - checks the native WebSocket `readyState` is `true` if
  and only if the state is CONNECTED.
- `socket.send(data)` If connected, calls the native WebSocket's `send` method;
  otherwise, the data is added to the WebSocketWrapper's send queue.
- `socket.disconnect()` Closes the native WebSocket
- `socket.set(key, value)` Saves user data specific to this WebSocketWrapper
- `socket.get(key)` Retrieves user data. See `socket.set(key, value)` above.

`WebSocketWrapper.MAX_SEND_QUEUE_SIZE` The maximum number of items allowed in
the send queue. If a user tries to send more messages than this number while a
WebSocket is not connected, errors will be thrown. Defaults to 10; changes
affect all WebSocketWrapper instances.

## Error Classes

ws-wrapper exports custom error classes that extend the standard `Error` class
to provide more specific error handling for different failure scenarios.

### RequestTimeoutError

```javascript
import WebSocketWrapper, { RequestTimeoutError } from "ws-wrapper"

socket
  .timeout(5000)
  .request("slowOperation")
  .catch((err) => {
    if (err instanceof RequestTimeoutError) {
      console.log("Request timed out after 5 seconds")
    }
  })
```

**Properties:**

- `name` "RequestTimeoutError"
- `message` "Request timed out"

This error is thrown when a request exceeds the configured timeout period. The
timeout can be set globally via the `requestTimeout` constructor option or
per-request using the `.timeout()` method.

### RequestAbortedError

```javascript
import WebSocketWrapper, { RequestAbortedError } from "ws-wrapper"

const controller = new AbortController()
socket
  .signal(controller.signal)
  .request("longOperation")
  .catch((err) => {
    if (err instanceof RequestAbortedError) {
      console.log("Request was cancelled:", err.reason)
    }
  })

// Cancel the request
controller.abort("User cancelled")
```

**Properties:**

- `name` "RequestAbortedError"
- `message` "Request aborted"
- `reason` The reason passed to `AbortController.abort()` (if any)

This error is thrown when a request is cancelled via an `AbortSignal`. The
optional `reason` property contains any cancellation reason that was provided
when calling `abort()`.

### Accessing Error Classes

Error classes are available in multiple ways:

```javascript
// Named imports
import { RequestTimeoutError, RequestAbortedError } from "ws-wrapper"

// Via the main class
import WebSocketWrapper from "ws-wrapper"
const TimeoutError = WebSocketWrapper.RequestTimeoutError
const AbortedError = WebSocketWrapper.RequestAbortedError
```

## Protocol

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
   set, `e` is a serialized Error object (with at least a `message` key) that is
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
   reason. The same rules as `e` apply: if `_` is set, `x` is a serialized Error
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

If the message received by the WebSocket is not valid JSON or if the parsed
Object does not match one of the above message types, then the message is simply
ignored by ws-wrapper. Also if the JSON message contains a `ws-wrapper` property
with the value `false`, the message will be ignored. This allows other libraries
to use the same WebSocket and send messages that will not be processed by
ws-wrapper.

## Request Cancellation with AbortSignal

Starting in version 4, ws-wrapper supports request cancellation using the Web
standard `AbortSignal` API. This allows you to cancel in-flight requests from
either the client or server side.

```javascript
const controller = new AbortController()

// Send a request that can be cancelled
const promise = socket.signal(controller.signal).request("longOperation", data)

// Cancel the request at any time
controller.abort()

// The promise will be rejected with "Request aborted"
promise.catch((err) => {
  if (err instanceof RequestAbortedError) {
    console.log("Request was cancelled by user")
  }
})
```

Event handlers can access the `AbortSignal` via `this.signal` to implement
cooperative cancellation:

```javascript
socket.on("longOperation", async function (data) {
  // Check if already cancelled
  if (this.signal?.aborted) {
    throw new Error("Operation was cancelled")
  }

  // Listen for cancellation during processing
  const onAbort = () => {
    // Perhaps do something here on abort...
  }
  this.signal?.addEventListener("abort", onAbort)

  try {
    // Do long running work, checking signal periodically
    for (let i = 0; i < 10; i++) {
      if (this.signal?.aborted) {
        throw new Error("Operation was cancelled")
      }
      await doSomeWork()
    }
    return "Operation completed"
  } finally {
    this.signal?.removeEventListener("abort", onAbort)
  }
})
```

### Combining with Timeout

You can use both timeout and cancellation together:

```javascript
import WebSocketWrapper, {
  RequestTimeoutError,
  RequestAbortedError,
} from "ws-wrapper"

const controller = new AbortController()

const promise = socket
  .timeout(30000) // 30 second timeout
  .signal(controller.signal) // User cancellation
  .request("heavyComputation", data)

// Handle different error types
promise.catch((err) => {
  if (err instanceof RequestTimeoutError) {
    console.log("Request timed out after 30 seconds")
  } else if (err instanceof RequestAbortedError) {
    console.log("Request was cancelled by user")
  } else {
    console.log("Request failed with other error:", err)
  }
})
```

## Auto-Reconnect

ws-wrapper does not implement auto-reconnect functionality out of the box. For
those who want it (_almost_ everyone), I have written some sample code to show
how easy it is to add.

[How to implement auto-reconnect for ws-wrapper](https://github.com/bminer/ws-wrapper/wiki/Client-side-Auto-Reconnect)

If someone wants to make an npm package for the auto-reconnect feature, I'd be
happy to list it here, but it will probably never be a core ws-wrapper feature.
