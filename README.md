# ws-wrapper

A lightweight, isomorphic library that brings named events, Promise-based
requests, channels, and more to native
[WebSockets](https://en.wikipedia.org/wiki/WebSocket) — with first-class support
for **web browsers**, **Node.js**, and **Go**.

## What?

Raw WebSockets give you one primitive: `send()`. ws-wrapper builds a practical
communication layer on top of that, so instead of parsing and routing raw
messages yourself, you get:

- **Named events** – emit an event on one end, handle it on the other (similar
  to [Socket.IO](https://socket.io/docs/))
- **Request / response** – send a request and get back a Promise that resolves
  (or rejects) with the remote handler's return value
- **Channels** – logically namespace events over a single WebSocket connection
- **Streaming** – anonymous (request-scoped) channels permit streaming /
  iterator patterns
- **Cancellation** – cancel in-flight requests using the standard `AbortSignal`
  API, with cooperative cancellation support on the remote end
- **Bi-directionality** – clients can request data from the server, and the
  server can also request data from clients

The wire protocol is a thin JSON layer over the native WebSocket, keeping
everything interoperable across JavaScript (browser or Node.js) and Go.

## Why?

[Socket.IO](https://socket.io/docs/) is great, but it lacks a few features and
ships with the heavier [engine.io](https://github.com/socketio/engine.io)
transport stack. If you're already using a plain WebSocket, ws-wrapper gives you
the event handling and request/response patterns you actually want – without the
overhead. The entire library and its dependencies weigh **under 12 KB minified**
(**under 4 KB** minified and gzipped).

## Install

**Node.js / Browser**

```
npm install ws-wrapper
```

or for Node.js servers, use the recommended
[ws-server-wrapper](https://github.com/bminer/ws-server-wrapper) library:

```
npm install ws-server-wrapper
```

**Go server** (use with
[ws-server-wrapper-go](https://github.com/bminer/ws-server-wrapper-go))

```
go get github.com/bminer/ws-server-wrapper-go
```

## Usage

ws-wrapper is an isomorphic ES module, so it works in Node.js and in the browser
(with or without a bundler like Webpack or Parcel.js).

Check out the
[example-app](https://github.com/bminer/ws-wrapper/tree/master/example-app) for
a sample chat application (recommended).

#### Client-side

```javascript
// Use a bundler to make the next line of code "work" on the browser
import WebSocketWrapper from "ws-wrapper"
// Create a new socket
const socket = new WebSocketWrapper(new WebSocket("ws://" + location.hostname))
// Now use the WebSocketWrapper API... `socket.emit` for example
socket.emit("msg", "my_name", "This is a test message")
// See additional examples below...
```

Note: This library is designed to work with all modern browsers, but if you need
support for older browsers, try using a code transpiler like
[Babel](https://babeljs.io/).

#### Server-side (Node.js)

We recommend using
[ws-server-wrapper](https://github.com/bminer/ws-server-wrapper) to wrap the
WebSocketServer. See the
[ws-server-wrapper README](https://github.com/bminer/ws-server-wrapper/blob/master/README.md)
for more details.

If you don't want to use ws-server-wrapper, you can wrap the WebSocket yourself
once a new WebSocket connects like this:

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
wrap your favorite WebSocket library. The example below uses the
[coder/websocket](https://github.com/coder/websocket) adapter:

```go
import (
    "log"
    "net/http"

    wrapper "github.com/bminer/ws-server-wrapper-go"
    "github.com/bminer/ws-server-wrapper-go/adapters/coder"
    "github.com/coder/websocket"
)

func main() {
    wsServer := wrapper.NewServer()
    // Register an event handler; return values are sent back as a response
    wsServer.On("echo", func(s string) (string, error) {
        return s, nil
    })
    // Create HTTP server that accepts WebSocket connections on /
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        conn, err := websocket.Accept(w, r, nil)
        if err != nil {
            return
        }
        wsServer.Accept(coder.Wrap(conn))
    })
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

See the [ws-server-wrapper-go](https://github.com/bminer/ws-server-wrapper-go)
repository for a complete example and other adapter options.

#### Other servers

Please implement ws-wrapper in your favorite language, and let me know about it!
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

Note: This module uses `JSON.stringify` to encode data as JSON over the raw
WebSocket connection. This means that encoding circular references is not
supported out of the box.

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
const wss = new WebSocketServer({ port: 3000 })
const sockets = new Set()
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
			// TODO: `path` should be sanitized for security reasons
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
const socket = new WebSocketWrapper(new WebSocket("ws://" + location.host))
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

### Request Timeout

Call `.timeout(ms)` directly before `.request(...)` like this:

```js
const promise = socket.timeout(5 * 1000).request("readFile", "/etc/issue")
```

The `timeout` function affects the next call of `request`.

### Request Cancellation

Starting in version 4, ws-wrapper supports request cancellation using the Web
standard `AbortSignal` API. This allows you to cancel in-flight requests from
either the client or server side.

```javascript
// Send a request that can be cancelled
const controller = new AbortController()
const promise = socket.signal(controller.signal).request("longOperation", data)
// Cancel the request at any time
controller.abort()
// The promise will be rejected with "Request aborted"
promise.catch((err) => {
	if (err instanceof RequestAbortedError) {
		console.log("Request was cancelled by user")
	}
})
// The remote end will also be notified of the cancellation
```

Event handlers can access the `AbortSignal` via `this.signal` to implement
cooperative cancellation:

```javascript
socket.on("longOperation", async function (data) {
	// Do long running work, checking signal periodically
	for (let i = 0; i < 10; i++) {
		if (this.signal?.aborted) {
			throw new Error("Operation was cancelled")
		}
		await doSomeWork()
	}
	return "Operation completed"
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

## Anonymous Channels

**Anonymous channels** are request-scoped channels. A request handler can call
`this.channel()` to create a channel and return it, and the requestor's
`request()` Promise resolves to a full `WebSocketChannel` instead of a plain
value. This provides a scoped, two-way communication primitive for streaming,
pagination, and other multi-message patterns — all over a single WebSocket
connection.

Anonymous channels should be explicitly closed when done. Use `chan.close()` to
clean up locally; use `chan.abort()` to also notify the remote end (which closes
its anonymous channel). Calling `emit` or `request` on a closed channel throws
an error. If the remote end sends a cancellation for the channel, the local
channel is automatically closed.

### One-way streaming (server pushes values to client)

Server-side example:

```javascript
socket.on("watchTemperature", function () {
	// Create an anonymous channel
	const chan = this.channel()
	// Register whatever listeners the client will emit on the channel
	chan.on("stop", () => chan.close())
	chan.on("start", () => {
		// Start pushing temperature readings once the client is ready
		const timer = setInterval(() => {
			try {
				// emit() / request() will throw if chan closes
				chan.emit("temp", getSensorReading())
			} catch (err) {
				clearInterval(timer)
			}
		}, 1000)
		// Clean up when the channel is closed
		chan.closeSignal?.addEventListener("abort", () => clearInterval(timer))
	})
	// Note: calling `chan.emit()` or `chan.request()` is not allowed here...
	// You have to return the channel first!
	return chan // returning a channel sends it to the requestor
})
```

Client-side example:

```javascript
// request() resolves to the anonymous channel
const chan = await socket.request("watchTemperature")
chan.on("temp", (val) => console.log("Temperature:", val))
chan.emit("start") // start emitting after "temp" event handler is registered

// Stop the stream after 10 seconds
setTimeout(() => {
	chan.emit("stop")
	chan.close()
}, 10000)
```

### Two-way communication (sub-requests on the channel)

Server-side example:

```javascript
socket.on("openCalculator", function () {
	const chan = this.channel()
	chan.on("add", function (a, b) {
		return a + b // return value is sent back as a response
	})
	chan.on("multiply", function (a, b) {
		return a * b
	})
	chan.on("done", () => chan.close())
	return chan
})
```

Client-side example:

```javascript
const calc = await socket.request("openCalculator")
const sum = await calc.request("add", 3, 4) // 7
const product = await calc.request("multiply", 6, 7) // 42
calc.emit("done") // closes remote side
calc.close() // closes my side *OR* calc.abort() closes both sides
```

### Async iterator

Anonymous channels have a built-in `[Symbol.asyncIterator]` implementation,
enabling one-way streaming using `for await...of`. The handler drives the stream
by emitting `"next"` events with `{ value, done }` payloads; the iterator emits
`"start"` on the first call to `next()` to signal readiness.

Server-side example:

```javascript
socket.on("generateNumbers", function () {
	const chan = this.channel()
	return chan.on("start", () => {
		for (let i = 1; i <= 100; i++) {
			chan.emit("next", { value: i, done: false })
		}
		chan.emit("next", { value: undefined, done: true })
		chan.close() // clean up server-side channel
	})
})
```

Client-side example:

```javascript
const chan = await socket.request("generateNumbers")
for await (const value of chan) {
	console.log(value) // 1, 2, ..., 100
}
// Iterator completed; channel is still open, so we close it
chan.close()
```

See [Async Iterator (One-way Streaming)](#async-iterator-one-way-streaming) in
the API section for full details on buffering, early exit, and error handling.

### Signal inheritance

When a requestor uses `signal()` with a `request()` that resolves to an
anonymous channel, the AbortSignal is inherited by the anonymous channel. If the
signal aborts after the channel is created, `chan.abort()` is called
automatically, sending a cancellation to the remote end and closing the channel
locally.

```javascript
const controller = new AbortController()
const chan = await socket.signal(controller.signal).request("startStream")
// The channel inherits the signal; aborting it aborts the channel.
controller.abort()
```

> [!NOTE]
>
> `timeout()` is **not** inherited by the anonymous channel. To impose a time
> limit on both the request and anonymous channel, pass an
> `AbortSignal.timeout()` as the signal:
>
> ```javascript
> const chan = await socket
> 	.signal(AbortSignal.timeout(30_000))
> 	.request("startStream")
> ```

## API

### WebSocketWrapper

A WebSocketWrapper simply wraps around a WebSocket to give you well-deserved
functionality. :smile:

`socket = new WebSocketWrapper(webSocketInstance[, options]);`

Constructs a new WebSocketWrapper and binds it to the native WebSocket instance.

- `webSocketInstance` - the
  [WebSocket instance](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- `options`
  - `debug` - set to `true` to print debugging messages to `console.log`; set to
    a function to call the custom function.
  - `errorToJSON` - function to encode Errors over the WebSocket. In Node.js,
    the default is to send only the `message` property of the Error (for
    security reasons). Errors that occur on the browser include all properties.
  - `requestTimeout` - default request timeout in milliseconds for outbound
    requests. Defaults to `null`, which means that there will be no timeout.
    This option is recommended for servers because clients who do not fulfill
    pending requests can cause memory leaks. As of version 4, we send
    cancellation messages to the remote end for requests that time out.

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

Every WebSocketWrapper (i.e. `socket`) is also a WebSocketChannel, which has an
EventEmitter-like API, request / response API, and more. Multiple channels can
be created to namespace events, despite using a single WebSocket connection.

### Channels

`const channel = socket.of(channelName)`

Returns the channel with the specified `channelName`, creating it if needed.
Every channel has the same EventEmitter-like API described below for sending and
handling channel-specific events and requests.

- `channel.name` Read-only `name` property matching the `channelName`. If the
  channel does not already exist, it is created.
- `channel.isAnonymous` Read-only boolean; `true` for anonymous channels created
  via `this.channel()` in a request handler **or** received as the resolved
  value of `socket.request()` on the requestor side. `false` for named channels
  and the root wrapper.
- `channel.closeSignal` Read-only `AbortSignal` (or `null` if the runtime does
  not support `AbortController`) that is aborted when the channel is closed via
  `close()` or `abort()`. Use this to register cleanup handlers that run when
  the channel is torn down:

  ```javascript
  chan.closeSignal?.addEventListener("abort", () => clearInterval(timer))
  ```

- `channel.close()` Removes the channel from the wrapper and cleans up all
  registered event listeners and middleware. After calling `close()`, the
  channel should no longer be used. For anonymous channels, any registered abort
  signal listeners are also removed.

### EventEmitter-like API

Both the WebSocketWrapper and WebSocketChannel implement the following methods:

- `channel.on(eventName, listener)` Adds the `listener` function to the end of
  the listeners array for the event named `eventName`. When an event or request
  matching the `eventName` is received by the WebSocket, the `listener` is
  called.

  Values returned by the `listener` callback are used to respond to requests
  (see `socket.request`). If the return value of the `listener` is a `Promise`,
  the response to the request will be sent once the Promise is resolved or
  rejected; otherwise, the return value of the `listener` is sent back to the
  remote end immediately. If the return value of the `listener` is a
  `WebSocketChannel` created via `this.channel()`, the requestor's `request()`
  Promise resolves to the anonymous channel (see Anonymous Channels above).

  If the inbound message is a simple event (see `socket.emit`), the return value
  of the `listener` is ignored. It is also "safe" for the `listener` to return a
  `Promise` even if the inbound message is a "simple" event. If the returned
  `Promise` is rejected, an unhandled rejection will not occur; rather, the
  result of the Promise is just ignored.

  If the `listener` throws an Error, this Error will propagate up the stack as
  expected, and if the inbound message was a request, the Error is sent back to
  the remote end as a response rejection.

  Event listeners also have access to `this`, which points to the event
  listener's socket / channel. In addition to the channel's API, the following
  are also available:
  - `this.signal` The AbortSignal for the current request if the requestor used
    `request(...)`; if the requestor used `emit(...)` to emit the event or if
    AbortController is not available to the runtime, this is `undefined`. The
    event handler can check this to see if the request has been cancelled and
    abort early.
  - `const anonChan = this.channel()` Creates and returns an anonymous channel
    scoped to this request. Returns the same channel instance if called more
    than once for the same request. Calling `emit()` or `request()` on the
    channel before returning it from the handler throws an error; once the
    channel is delivered to the requestor, all methods are available.

- `channel.once(eventName, listener)` Adds a one time `listener` function for
  the event named `eventName`; otherwise, this behaves exactly like `on` above.
- `channel.removeListener(eventName, listener)` Removes the specified `listener`
  from the listener array for the event named `eventName`.
- `channel.removeAllListeners([eventName])` Removes all listeners, or those of
  the specified `eventName`.
- `channel.eventNames()` Returns an array listing the events for which the
  emitter has registered listeners.
- `channel.listeners(eventName)` Returns a copy of the array of listeners for
  the event named `eventName`.
- `channel.emit(eventName[, ...args])` Sends an event down the WebSocket with
  the specified `eventName` calling all listeners for `eventName` on the remote
  end, in the order they were registered, passing the supplied arguments to
  each. Calling `emit` on a closed channel will throw.

The above EventEmitter functions like `on` and `once` are chainable (as
appropriate).

### Request / Response

- `channel.request(eventName[, ...args])` Sends a request down the WebSocket
  with the specified `eventName` and returns a
  [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
  that will resolve once the remote event listener responds. If the remote
  handler returns an anonymous channel (via `this.channel()`), the Promise
  resolves to a `WebSocketChannel` instance instead of a plain value; see the
  [Anonymous Channels](#anonymous-channels) section above.

  **Note**: While it is common design for only one event listener to exist on
  the remote end, all listeners for `eventName` on the remote end are called, in
  the order they were registered, passing the supplied arguments to each. Since
  Promises can only be resolved or rejected once, only the data from the first
  event listener is used to generate the response for this request.

  **Note**: If a request is sent, but there is no remote event listener to
  respond to the request, a response rejection is immediately sent back by the
  remote end.

- `channel.timeout(ms)` Temporarily set the timeout for the next request only.
  This returns `channel` to allow chaining. Applies to both named and anonymous
  channels. Typical usage:

  ```js
  // The next request will be rejected if there is no response for 5 secs.
  let promise = socket.timeout(5 * 1000).request("readFile", "/etc/issue")
  ```

- `channel.signal(abortSignal)` Temporarily set the `AbortSignal` for the next
  request only. This allows cancellation of in-flight requests. This returns
  `channel` to allow chaining. Can be combined with `timeout()`. Typical usage:

  ```js
  const controller = new AbortController()
  // The next request can be cancelled using the AbortController
  let promise = socket
  	.of("compute")
  	.signal(controller.signal)
  	.request("longOperation", data)
  // Later, we can cancel the request. In this case, our Promise will be
  // immediately rejected with RequestAbortedError, and the remote end will
  // receive a cancellation message.
  controller.abort()
  ```

### Async Iterator (One-way Streaming)

An anonymous channel implements the
[async iterator protocol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols),
enabling one-way streaming from the handler side to the requestor side using
`for await...of`:

```js
// --- Requestor side ---
const chan = await socket.request("open-stream")
for await (const value of chan) {
	console.log(value)
}
// Channel is still open after the loop; close or abort when done.
chan.close()

// --- Handler side (drives the stream) ---
socket.on("open-stream", function () {
	const chan = this.channel()
	// Return the channel first; the requestor then emits "start" when ready.
	chan.on("start", async () => {
		for (const item of items) {
			chan.emit("next", { value: item, done: false })
			await delay(100)
		}
		chan.emit("next", { value: undefined, done: true })
		chan.close() // clean up server-side channel
	})
	return chan
})
```

The remote handler drives the stream by emitting `"next"` events on the
anonymous channel with `{ value, done }` payloads. When `done` is `true`, the
iterator completes; the channel itself remains open.

**Handshake**: on the first call to `iterator.next()` (including the first
iteration of `for await...of`), the iterator emits a `"start"` event on the
channel so the handler knows the consumer is ready. The handler should listen
for `"start"` before emitting any `"next"` events.

**Buffering**: the iterator buffers at most **one** unconsumed item. The
consumer must call `next()` (or advance the `for await...of` loop) before the
next item arrives. If two items arrive before the consumer reads the first, the
iterator errors with a buffer-overflow but the channel remains open.

**Early exit**: breaking out of a `for await...of` loop (or calling
`iterator.return()`) stops iteration but does **not** close the channel. Call
`chan.close()` or `chan.abort()` afterward if the channel is no longer needed.

**Throwing**: calling `iterator.throw(err)` sends a cancellation message to the
remote end (anonymous channels only), closes the channel, and rejects with
`err`.

**External close**: if the channel is closed by a signal abort or explicit
`chan.close()` / `chan.abort()` while the consumer is waiting, the pending
`next()` Promise is rejected with an error.

### Middleware

`socket.use(function fn(eventName, args, next) {...})`

Adds a middleware function `fn` to receive all messages for the channel. The
`eventName` indicates the name of the event or request, and the `args` are the
arguments to be passed to the respective event handler. `next([err])` should be
called to continue processing to the next middleware function. Once all
middleware have processed the event and called `next`, the event is then
processed by the event handler(s) for the `eventName`. If `next(err)` is called
with an Error, the event will not be handled by subsequent middleware or
registered event handlers, and if it's a request, a response rejection is sent
back to the remote end.

### Other methods and properties

By default, the WebSocketWrapper provides a queue for data to be sent. Once the
WebSocket is open, this queue is flushed until the connection is lost. The
following methods allow one to re-bind a new WebSocket or clear the send queue.
This is useful for reconnecting or connecting to a different server.

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
  and only if the state is OPEN.
- `socket.send(data)` If connected, calls the native WebSocket's `send` method;
  otherwise, the data string is added to the WebSocketWrapper's send queue.
- `socket.disconnect()` Closes the native WebSocket
- `socket.set(key, value)` Saves user data specific to this WebSocketWrapper
- `socket.get(key)` Retrieves user data. See `socket.set(key, value)` above.

`WebSocketWrapper.MAX_SEND_QUEUE_SIZE` The maximum number of items allowed in
the send queue. If a user tries to send more messages than this number while a
WebSocket is not connected, errors will be thrown. Defaults to 10; changes
affect all WebSocketWrapper instances.

### Error Classes

ws-wrapper exports custom error classes that extend the standard `Error` class
to provide more specific error handling for different failure scenarios.

#### RequestTimeoutError

This error is thrown when a request exceeds the configured timeout period. The
timeout can be set globally via the `requestTimeout` constructor option or
per-request using the `.timeout()` method.

- `name` "RequestTimeoutError"
- `message` "Request timed out"

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

#### RequestAbortedError

This error is thrown when a request is cancelled via an `AbortSignal`. The
optional `reason` property contains any cancellation reason that was provided
when calling `abort()`.

- `name` "RequestAbortedError"
- `message` "Request aborted"
- `reason` The reason passed to `AbortController.abort()` (if any)

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

#### Accessing Error Classes

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

## Auto-Reconnect

ws-wrapper does not implement auto-reconnect functionality out of the box. For
those who want it (_almost_ everyone), I have written some sample code to show
how easy it is to add.

[How to implement auto-reconnect for ws-wrapper](https://github.com/bminer/ws-wrapper/wiki/Client-side-Auto-Reconnect)

If someone wants to make an npm package for the auto-reconnect feature, I'd be
happy to list it here, but it will probably never be a core ws-wrapper feature.
